import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { AuditService } from "../../kernel/audit/audit.service";
import type { JwtPayload } from "../iam/auth.types";
import type { PaymentTermTemplate } from "./contract.service";

export interface MilestoneInput {
  label: string;
  percentage?: number;
  amount?: number;
  triggerNote?: string;
  blocksShipment?: boolean;
  dueAt?: string;
}

/**
 * 付款里程碑（R1.5-1）：把真实合同的分期条款结构化。
 * 典型："收到 CITES 扫描件后 T/T 50%" + "发货前结清尾款"。
 *
 * 与状态机的关系：
 *  - 首笔里程碑支付成功 → 订单进入 PAID_ESCROW（供应商可接单备货）；
 *  - blocksShipment 的里程碑未付清 → 发货被拦截（TradingService.transition 调用 assertShippable）。
 */
@Injectable()
export class MilestoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 下单时按合同条款或显式输入生成里程碑；无条款则不生成（走原有一次性全额支付） */
  async createForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    total: Prisma.Decimal,
    currency: string,
    terms: PaymentTermTemplate[] | MilestoneInput[],
    userId?: string,
  ): Promise<void> {
    if (!terms?.length) return;
    let allocated = new Prisma.Decimal(0);
    for (const [i, term] of terms.entries()) {
      const isLast = i === terms.length - 1;
      const pct = term.percentage != null ? new Prisma.Decimal(term.percentage) : null;
      // 末期取差额，避免百分比取整造成分币误差
      const amount = isLast
        ? total.minus(allocated)
        : ("amount" in term && term.amount != null)
          ? new Prisma.Decimal(term.amount)
          : total.mul(pct ?? new Prisma.Decimal(0)).div(100).toDecimalPlaces(2);
      allocated = allocated.plus(amount);
      await tx.paymentMilestone.create({
        data: {
          orderId,
          seq: i + 1,
          label: term.label,
          triggerNote: term.triggerNote,
          percentage: pct,
          amount,
          currency,
          blocksShipment: term.blocksShipment ?? true,
          dueAt: "dueAt" in term && term.dueAt ? new Date(term.dueAt) : undefined,
          createdBy: userId,
        },
      });
    }
  }

  async listForOrder(orderCode: string, user: JwtPayload) {
    const order = await this.findAccessibleOrder(orderCode, user);
    const rows = await this.prisma.paymentMilestone.findMany({
      where: { orderId: order.id, deletedAt: null },
      orderBy: { seq: "asc" },
    });
    const paid = rows.filter((m) => m.status === "PAID").reduce((s, m) => s.plus(m.amount), new Prisma.Decimal(0));
    return {
      milestones: rows.map((m) => ({
        id: m.id, seq: m.seq, label: m.label, triggerNote: m.triggerNote,
        percentage: m.percentage, amount: m.amount, currency: m.currency,
        blocksShipment: m.blocksShipment, status: m.status, dueAt: m.dueAt, paidAt: m.paidAt,
      })),
      paidTotal: paid,
      outstanding: rows.reduce((s, m) => s.plus(m.amount), new Prisma.Decimal(0)).minus(paid),
    };
  }

  /** 供应商/内部登记线下电汇到账（真实外贸里定金多为 T/T） */
  async markPaid(milestoneId: string, user: JwtPayload, note?: string) {
    const milestone = await this.prisma.paymentMilestone.findFirst({ where: { id: milestoneId, deletedAt: null } });
    if (!milestone) throw new NotFoundException({ code: "NOT_FOUND", detail: "里程碑不存在" });
    const order = await this.prisma.tradeOrder.findUniqueOrThrow({ where: { id: milestone.orderId } });
    const isStaff = user.roles.some((r) => ["ADMIN", "SUPER_ADMIN", "FINANCE"].includes(r));
    if (order.supplierOrgId !== user.orgId && !isStaff) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅供应商或平台财务可登记到账" });
    }
    if (milestone.status === "PAID") {
      throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "该期已标记为已付" });
    }
    const updated = await this.prisma.paymentMilestone.update({
      where: { id: milestoneId },
      data: { status: "PAID", paidAt: new Date(), updatedBy: user.sub, version: { increment: 1 } },
    });
    await this.audit.log({
      actorId: user.sub, actorRole: user.roles.join(","), action: "MILESTONE_MARKED_PAID",
      targetType: "PaymentMilestone", targetId: milestoneId,
      diff: { orderCode: order.publicCode, seq: milestone.seq, amount: milestone.amount.toString(), note },
    });
    return { id: updated.id, seq: updated.seq, status: updated.status, paidAt: updated.paidAt };
  }

  /**
   * 把线上支付（Stripe 托管）归集到最早未付里程碑。
   * 无里程碑的订单（一次性全额）不受影响。
   */
  async settleByPayment(tx: Prisma.TransactionClient, orderId: string, paymentId: string, amount: Prisma.Decimal): Promise<void> {
    const pending = await tx.paymentMilestone.findMany({
      where: { orderId, status: "PENDING", deletedAt: null },
      orderBy: { seq: "asc" },
    });
    if (pending.length === 0) return;
    let left = amount;
    for (const m of pending) {
      if (left.lte(0)) break;
      if (left.gte(m.amount)) {
        await tx.paymentMilestone.update({
          where: { id: m.id },
          data: { status: "PAID", paidAt: new Date(), paymentId, version: { increment: 1 } },
        });
        left = left.minus(m.amount);
      } else {
        break; // 不足以覆盖整期则保持 PENDING，避免部分付款造成状态歧义
      }
    }
  }

  /** 发货前校验：blocksShipment 的里程碑必须全部付清 */
  async assertShippable(orderId: string): Promise<void> {
    const blocking = await this.prisma.paymentMilestone.findMany({
      where: { orderId, deletedAt: null, blocksShipment: true, status: { in: ["PENDING", "OVERDUE"] } },
      orderBy: { seq: "asc" },
    });
    if (blocking.length > 0) {
      const outstanding = blocking.reduce((s, m) => s.plus(m.amount), new Prisma.Decimal(0));
      throw new ConflictException({
        code: "MILESTONE_UNPAID",
        detail: `发货前须结清款项：${blocking.map((m) => m.label).join("、")}（合计 ${outstanding} ${blocking[0]!.currency}）`,
        milestones: blocking.map((m) => ({ seq: m.seq, label: m.label, amount: m.amount.toString() })),
      });
    }
  }

  private async findAccessibleOrder(orderCode: string, user: JwtPayload) {
    const order = await this.prisma.tradeOrder.findFirst({ where: { publicCode: orderCode, deletedAt: null } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", detail: "订单不存在" });
    const isStaff = user.roles.some((r) => ["ADMIN", "SUPER_ADMIN", "FINANCE", "BROKER"].includes(r));
    if (order.buyerOrgId !== user.orgId && order.supplierOrgId !== user.orgId && !isStaff) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织订单" });
    }
    return order;
  }

  /** 校验自定义里程碑输入 */
  static validate(milestones: MilestoneInput[] | undefined): void {
    if (!milestones?.length) return;
    const hasPct = milestones.every((m) => m.percentage != null);
    if (hasPct) {
      const sum = milestones.reduce((s, m) => s + (m.percentage ?? 0), 0);
      if (Math.abs(sum - 100) > 0.01) {
        throw new BadRequestException({ code: "VALIDATION_FAILED", detail: `分期占比合计需为 100%，当前 ${sum}%` });
      }
    }
  }
}
