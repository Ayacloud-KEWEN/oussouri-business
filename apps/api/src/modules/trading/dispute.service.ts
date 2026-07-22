import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { CommunicationService } from "../communication/communication.service";
import { TradingService } from "./trading.service";
import type { JwtPayload } from "../iam/auth.types";

/** 争议理由（对应鱼子酱贸易的高频质量问题） */
export const DISPUTE_REASONS = [
  "QUALITY_DEFECT",      // 品质不符（出油、异味、粒径不达标）
  "QUANTITY_SHORT",      // 数量短少
  "COLD_CHAIN_BREACH",   // 冷链断链/温度超标
  "DOCUMENT_MISSING",    // 单证缺失导致清关受阻
  "DELIVERY_DELAY",      // 严重延迟交付
  "OTHER",
] as const;

export type DisputeResolutionType = "REJECT" | "REFUND_FULL" | "REFUND_PARTIAL";

const SYSTEM_ACTOR: JwtPayload = { sub: "00000000-0000-0000-0000-000000000000", roles: ["SYSTEM"] } as JwtPayload;

/**
 * 争议处理（R1-6）：托管模式的信任基石 —— 没有可发起的争议，"钱在平台"对买家就不成立。
 *
 * 资金规则：
 *  - 争议存续期间 releaseEscrow 被拒（既有检查），托管资金冻结；
 *  - 裁决驳回 → 正常放款；全额退款 → 退买家、供应商不结算；
 *  - 部分退款 → 退款部分退买家，余额按原佣金比例分账后放款。
 */
@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly comm: CommunicationService,
    private readonly trading: TradingService,
  ) {}

  /** 买家（或供应商）在争议期内发起 */
  async open(
    input: { orderCode: string; reasonCode: string; description: string; evidence?: unknown[] },
    user: JwtPayload,
  ) {
    const order = await this.prisma.tradeOrder.findFirst({ where: { publicCode: input.orderCode, deletedAt: null } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", detail: "订单不存在" });
    const isBuyer = order.buyerOrgId === user.orgId;
    const isSupplier = order.supplierOrgId === user.orgId;
    if (!isBuyer && !isSupplier) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅交易双方可发起争议" });
    }
    if (order.status !== "DELIVERED") {
      throw new ConflictException({
        code: "STATE_TRANSITION_DENIED",
        detail: `仅已签收订单可发起争议（当前 ${order.status}）`,
      });
    }
    if (order.disputeUntil && order.disputeUntil < new Date()) {
      throw new ConflictException({
        code: "DISPUTE_WINDOW_CLOSED",
        detail: `争议期已于 ${order.disputeUntil.toISOString().slice(0, 10)} 截止`,
      });
    }
    const existing = await this.prisma.dispute.findFirst({
      where: { orderId: order.id, status: { in: ["OPEN", "INVESTIGATING"] }, deletedAt: null },
    });
    if (existing) throw new ConflictException({ code: "CONFLICT", detail: "该订单已有进行中的争议" });

    const dispute = await this.prisma.dispute.create({
      data: {
        orderId: order.id,
        raisedByOrgId: user.orgId!,
        reasonCode: input.reasonCode,
        description: input.description,
        evidence: (input.evidence ?? []) as Prisma.InputJsonValue,
        status: "OPEN",
        createdBy: user.sub,
      },
    });
    // 订单转 DISPUTED：托管资金随之冻结
    await this.trading.transition(order.publicCode, "DISPUTED", user, { reason: `dispute:${input.reasonCode}` });
    await this.audit.log({
      actorId: user.sub, actorRole: user.roles.join(","), action: "DISPUTE_OPENED",
      targetType: "Dispute", targetId: dispute.id,
      diff: { orderCode: order.publicCode, reasonCode: input.reasonCode },
    });
    await this.notifyCounterparty(order, isBuyer, "DISPUTE_OPENED", { orderCode: order.publicCode, reasonCode: input.reasonCode });

    return { disputeId: dispute.id, orderCode: order.publicCode, status: dispute.status };
  }

  /** 补充证据（双方均可） */
  async addEvidence(disputeId: string, evidence: unknown[], user: JwtPayload) {
    const { dispute, order } = await this.findAccessible(disputeId, user);
    if (!["OPEN", "INVESTIGATING"].includes(dispute.status)) {
      throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "争议已结案" });
    }
    const merged = [...((dispute.evidence as unknown[]) ?? []), ...evidence.map((e) => ({
      at: new Date().toISOString(), byOrgId: user.orgId, item: e,
    }))];
    await this.prisma.dispute.update({
      where: { id: disputeId },
      data: { evidence: merged as Prisma.InputJsonValue, status: "INVESTIGATING", updatedBy: user.sub, version: { increment: 1 } },
    });
    await this.audit.log({
      actorId: user.sub, actorRole: user.roles.join(","), action: "DISPUTE_EVIDENCE_ADDED",
      targetType: "Dispute", targetId: disputeId, diff: { orderCode: order.publicCode, count: evidence.length },
    });
    return { disputeId, evidenceCount: merged.length };
  }

  async list(user: JwtPayload, status?: string) {
    const isStaff = this.isStaff(user);
    const where: Prisma.DisputeWhereInput = { deletedAt: null, ...(status ? { status } : {}) };
    if (!isStaff) {
      const orders = await this.prisma.tradeOrder.findMany({
        where: { deletedAt: null, OR: [{ buyerOrgId: user.orgId ?? "" }, { supplierOrgId: user.orgId ?? "" }] },
        select: { id: true },
      });
      where.orderId = { in: orders.map((o) => o.id) };
    }
    const disputes = await this.prisma.dispute.findMany({ where, orderBy: { createdAt: "desc" } });
    if (disputes.length === 0) return [];
    const orders = await this.prisma.tradeOrder.findMany({
      where: { id: { in: disputes.map((d) => d.orderId) } },
      select: { id: true, publicCode: true, grandTotal: true, currency: true, status: true, buyerOrgId: true, supplierOrgId: true },
    });
    const orgIds = [...new Set(orders.flatMap((o) => [o.buyerOrgId, o.supplierOrgId]))];
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, publicCode: true } });
    const codeOf = new Map(orgs.map((o) => [o.id, o.publicCode]));

    return disputes.map((d) => {
      const order = orders.find((o) => o.id === d.orderId);
      return {
        id: d.id,
        orderCode: order?.publicCode,
        orderStatus: order?.status,
        amount: order?.grandTotal,
        currency: order?.currency,
        // 身份防火墙：只输出平台代码
        raisedBy: codeOf.get(d.raisedByOrgId) ?? "UNKNOWN",
        buyerCode: order ? codeOf.get(order.buyerOrgId) : undefined,
        supplierCode: order ? codeOf.get(order.supplierOrgId) : undefined,
        reasonCode: d.reasonCode,
        description: d.description,
        evidence: d.evidence,
        status: d.status,
        resolution: d.resolution,
        createdAt: d.createdAt,
      };
    });
  }

  /**
   * 平台裁决（ADMIN）。
   * REJECT → 放款给供应商；REFUND_FULL → 全额退买家；REFUND_PARTIAL → 按额退款，余额分账。
   */
  async resolve(
    disputeId: string,
    input: { decision: DisputeResolutionType; refundAmount?: number; reason: string },
    user: JwtPayload,
  ) {
    if (!this.isStaff(user)) throw new ForbiddenException({ code: "PERM_DENIED", detail: "仅平台可裁决" });
    const dispute = await this.prisma.dispute.findFirst({ where: { id: disputeId, deletedAt: null } });
    if (!dispute) throw new NotFoundException({ code: "NOT_FOUND", detail: "争议不存在" });
    if (!["OPEN", "INVESTIGATING"].includes(dispute.status)) {
      throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "争议已结案" });
    }
    const order = await this.prisma.tradeOrder.findUniqueOrThrow({ where: { id: dispute.orderId } });

    const refund = input.decision === "REFUND_FULL"
      ? order.grandTotal
      : input.decision === "REFUND_PARTIAL"
        ? new Prisma.Decimal(input.refundAmount ?? 0)
        : new Prisma.Decimal(0);
    if (input.decision === "REFUND_PARTIAL" && (refund.lte(0) || refund.gte(order.grandTotal))) {
      throw new ConflictException({
        code: "VALIDATION_FAILED",
        detail: `部分退款金额需介于 0 与订单金额 ${order.grandTotal} 之间`,
      });
    }

    // 退款后余额按原佣金比例分账，保证账本平衡
    const remaining = order.grandTotal.minus(refund);
    const commission = remaining.mul(order.commissionRate).toDecimalPlaces(2);
    const supplierAmount = remaining.minus(commission);

    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: "RESOLVED",
          resolution: {
            decision: input.decision,
            refundAmount: refund.toString(),
            supplierAmount: supplierAmount.toString(),
            commission: commission.toString(),
            reason: input.reason,
            resolvedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
          resolvedBy: user.sub,
          updatedBy: user.sub,
          version: { increment: 1 },
        },
      });

      const journalId = randomUUID();
      const entries: Prisma.LedgerEntryCreateManyInput[] = [
        { journalId, account: "ESCROW_HELD", orderId: order.id, direction: "DEBIT", amount: order.grandTotal, currency: order.currency },
      ];
      if (refund.gt(0)) {
        const payment = await tx.payment.findFirst({ where: { orderId: order.id, status: "SUCCEEDED", deletedAt: null }, orderBy: { createdAt: "asc" } });
        if (payment) {
          await tx.refund.create({
            data: {
              paymentId: payment.id,
              amount: refund,
              reasonCode: dispute.reasonCode,
              status: "PENDING", // 真实网关下由 Stripe 退款回调置 SUCCEEDED
              createdBy: user.sub,
            },
          });
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: refund.gte(order.grandTotal) ? "REFUNDED" : "PARTIAL_REFUND", version: { increment: 1 } },
          });
        }
        entries.push({ journalId, account: "REFUND_PAYABLE", orgId: order.buyerOrgId, orderId: order.id, direction: "CREDIT", amount: refund, currency: order.currency });
      }
      if (supplierAmount.gt(0)) {
        entries.push({ journalId, account: "SUPPLIER_PAYABLE", orgId: order.supplierOrgId, orderId: order.id, direction: "CREDIT", amount: supplierAmount, currency: order.currency });
      }
      if (commission.gt(0)) {
        entries.push({ journalId, account: "PLATFORM_COMMISSION", orderId: order.id, direction: "CREDIT", amount: commission, currency: order.currency });
      }
      await tx.ledgerEntry.createMany({ data: entries });

      await this.audit.logInTx(tx, {
        actorId: user.sub, actorRole: user.roles.join(","), action: "DISPUTE_RESOLVED",
        targetType: "Dispute", targetId: disputeId,
        diff: { orderCode: order.publicCode, decision: input.decision, refund: refund.toString(), supplierAmount: supplierAmount.toString() },
        reason: input.reason,
      });
    });

    // 订单收口：DISPUTED → RESOLVED；驳回争议时继续走完成
    await this.trading.transition(order.publicCode, "RESOLVED", user, { reason: `dispute:${input.decision}` });
    if (input.decision === "REJECT") {
      try {
        await this.trading.transition(order.publicCode, "COMPLETED", SYSTEM_ACTOR, { asSystem: true, reason: "dispute rejected" });
      } catch (e) {
        // 状态机若无 RESOLVED→COMPLETED 通路则保持 RESOLVED，不影响资金结果
        this.logger.warn(`订单 ${order.publicCode} 争议驳回后未能自动完成：${(e as Error).message}`);
      }
    }

    for (const orgId of [order.buyerOrgId, order.supplierOrgId]) {
      const members = await this.prisma.membership.findMany({ where: { orgId, deletedAt: null } });
      for (const m of members) {
        await this.comm.notifyUser(m.userId, "DISPUTE_RESOLVED", {
          orderCode: order.publicCode, decision: input.decision, refundAmount: refund.toString(),
        });
      }
    }

    return {
      disputeId,
      decision: input.decision,
      refundAmount: refund.toString(),
      supplierAmount: supplierAmount.toString(),
      commission: commission.toString(),
    };
  }

  private async findAccessible(disputeId: string, user: JwtPayload) {
    const dispute = await this.prisma.dispute.findFirst({ where: { id: disputeId, deletedAt: null } });
    if (!dispute) throw new NotFoundException({ code: "NOT_FOUND", detail: "争议不存在" });
    const order = await this.prisma.tradeOrder.findUniqueOrThrow({ where: { id: dispute.orderId } });
    if (order.buyerOrgId !== user.orgId && order.supplierOrgId !== user.orgId && !this.isStaff(user)) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织争议" });
    }
    return { dispute, order };
  }

  private async notifyCounterparty(
    order: { buyerOrgId: string; supplierOrgId: string },
    raisedByBuyer: boolean,
    template: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const targetOrgId = raisedByBuyer ? order.supplierOrgId : order.buyerOrgId;
    const members = await this.prisma.membership.findMany({ where: { orgId: targetOrgId, deletedAt: null } });
    for (const m of members) await this.comm.notifyUser(m.userId, template, payload);
  }

  private isStaff(user: JwtPayload): boolean {
    return user.roles.some((r) => ["ADMIN", "SUPER_ADMIN", "CUSTOMER_SERVICE"].includes(r));
  }
}
