import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CodeGeneratorService } from "../../kernel/codegen/code-generator.service";
import { StateMachineService } from "../../kernel/state-machine/state-machine.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { CommunicationService } from "../communication/communication.service";
import { pickPriceTier } from "../trading/price-tier.util";
import type { JwtPayload } from "../iam/auth.types";

const INTENT_TTL_HOURS = 24;

@Injectable()
export class BrokerageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codegen: CodeGeneratorService,
    private readonly stateMachine: StateMachineService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly comm: CommunicationService,
  ) {}

  /** 商机流（按紧迫度排序，双方仅代码） */
  async listOpportunities(status: string | undefined, user: JwtPayload) {
    const opportunities = await this.prisma.opportunity.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status } : { status: { in: ["NEW", "CONTACTED", "NEGOTIATING"] } }),
      },
      orderBy: [{ urgencyScore: "desc" }, { createdAt: "desc" }],
      take: 50,
    });
    const orgIds = [...new Set(opportunities.flatMap((o) => [o.buyerOrgId, o.supplierOrgId]))];
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, publicCode: true, countryIso2: true } });
    const orgMap = new Map(orgs.map((o) => [o.id, o]));
    const skus = await this.prisma.productSku.findMany({
      where: { id: { in: opportunities.map((o) => o.skuId).filter((v): v is string => Boolean(v)) } },
      include: { product: { select: { name: true, publicCode: true } } },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s]));
    return opportunities.map((o) => ({
      code: o.publicCode,
      status: o.status,
      signal: o.sourceSignal,
      buyerCode: orgMap.get(o.buyerOrgId)?.publicCode,
      buyerCountry: orgMap.get(o.buyerOrgId)?.countryIso2,
      supplierCode: orgMap.get(o.supplierOrgId)?.publicCode,
      product: o.skuId ? { name: skuMap.get(o.skuId)?.product.name, skuCode: skuMap.get(o.skuId)?.skuCode } : null,
      scores: { matching: o.matchingScore, opportunity: o.opportunityScore, urgency: o.urgencyScore, profit: o.profitScore },
      explanation: o.explanation,
      assignedToMe: o.assignedBrokerId === user.sub,
      createdAt: o.createdAt,
    }));
  }

  async claim(code: string, user: JwtPayload) {
    const opp = await this.findOpp(code);
    if (opp.assignedBrokerId && opp.assignedBrokerId !== user.sub) {
      throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "商机已被其他居间专员认领" });
    }
    await this.prisma.opportunity.update({
      where: { id: opp.id },
      data: { assignedBrokerId: user.sub, updatedBy: user.sub, version: { increment: 1 } },
    });
    await this.audit.log({ actorId: user.sub, actorRole: user.roles.join(","), action: "OPPORTUNITY_CLAIM", targetType: "Opportunity", targetId: opp.id });
    return { code, assigned: true };
  }

  async transition(code: string, toState: string, user: JwtPayload, reason?: string) {
    const opp = await this.findOpp(code);
    const { emitsEvent } = await this.stateMachine.assertAllowed("OPPORTUNITY", opp.status, toState, user.roles);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.opportunity.updateMany({
        where: { id: opp.id, version: opp.version },
        data: { status: toState, lostReason: toState === "LOST" ? reason : undefined, updatedBy: user.sub, version: { increment: 1 } },
      });
      if (updated.count === 0) throw new ConflictException({ code: "VERSION_CONFLICT", detail: "商机已被并发修改" });
      await tx.opportunityActivity.create({
        data: { opportunityId: opp.id, activityType: "STATUS_CHANGE", payload: { from: opp.status, to: toState, reason }, createdBy: user.sub },
      });
      await this.stateMachine.recordInTx(
        tx, "OPPORTUNITY", opp.status, toState,
        { actorId: user.sub, actorRoles: user.roles, targetType: "Opportunity", targetId: opp.id, reason },
        emitsEvent, { opportunityId: opp.id, code, to: toState },
      );
    });
    return { code, status: toState };
  }

  async addActivity(code: string, activityType: string, payload: Prisma.InputJsonValue, user: JwtPayload) {
    const opp = await this.findOpp(code);
    await this.prisma.opportunityActivity.create({
      data: { opportunityId: opp.id, activityType, payload, createdBy: user.sub },
    });
    return { ok: true };
  }

  /**
   * 居间代下单（M14 FR-14-05）：生成 BROKER 意向单 + 24h 库存预留 +
   * 以平台名义向买家推送带支付指引的通知；买家走既有 checkout 支付。
   */
  async createBrokerOrder(
    input: { buyerOrgCode: string; skuCode: string; qty: number; unitPriceEur: number; opportunityCode?: string },
    user: JwtPayload,
  ) {
    const buyer = await this.prisma.organization.findFirst({ where: { publicCode: input.buyerOrgCode, status: "ACTIVE", deletedAt: null } });
    if (!buyer) throw new NotFoundException({ code: "NOT_FOUND", detail: "买家不存在或未激活" });
    const sku = await this.prisma.productSku.findFirst({
      where: { skuCode: input.skuCode, status: "ACTIVE", deletedAt: null },
      include: { product: true, priceTiers: { where: { isActive: true, deletedAt: null, currency: "EUR" } } },
    });
    if (!sku) throw new NotFoundException({ code: "NOT_FOUND", detail: "SKU 不可购" });

    const qty = new Prisma.Decimal(input.qty);
    // 居间价可议，但不得低于该量级阶梯价的 70%（防超低价甩卖，规则可配置化待办）
    const tier = pickPriceTier(sku.priceTiers, qty);
    if (tier && new Prisma.Decimal(input.unitPriceEur).lt(tier.unitPrice.mul("0.7"))) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", detail: `议价低于底线（阶梯价 €${tier.unitPrice} 的 70%）` });
    }
    const unitPrice = new Prisma.Decimal(input.unitPriceEur);
    const itemsTotal = unitPrice.mul(qty);

    const order = await this.prisma.$transaction(async (tx) => {
      const orderCode = await this.codegen.next("ORDER", tx);
      const commissionRate = new Prisma.Decimal("0.08");
      const order = await tx.tradeOrder.create({
        data: {
          publicCode: orderCode,
          orderType: "BROKER",
          buyerOrgId: buyer.id,
          supplierOrgId: sku.product.supplierOrgId,
          brokerUserId: user.sub,
          currency: "EUR",
          fxRateToEur: new Prisma.Decimal(1),
          itemsTotal,
          commissionRate,
          commissionAmount: itemsTotal.mul(commissionRate).toDecimalPlaces(2),
          grandTotal: itemsTotal,
          status: "PLACED",
          placedAt: new Date(),
          notes: input.opportunityCode ? `broker intent from ${input.opportunityCode}` : "broker intent",
          createdBy: user.sub,
        },
      });
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          skuId: sku.id,
          qty,
          unitPrice,
          lineTotal: itemsTotal,
          snapshot: { skuCode: sku.skuCode, packSpec: sku.packSpec, productName: sku.product.name, productCode: sku.product.publicCode, negotiatedBy: "BROKER" },
        },
      });
      await this.inventory.reserveInTx(tx, sku.id, qty, "ORDER", order.id, new Date(Date.now() + INTENT_TTL_HOURS * 3600_000), user.sub);
      await this.stateMachine.recordInTx(
        tx, "ORDER", "DRAFT", "PLACED",
        { actorId: user.sub, actorRoles: user.roles, targetType: "TradeOrder", targetId: order.id, reason: "broker create-on-behalf" },
        "OrderPlaced", { orderId: order.id, code: orderCode, broker: true },
      );
      return order;
    });

    // 商机联动：记录跟进 + 状态推进到 NEGOTIATING（若有）
    if (input.opportunityCode) {
      const opp = await this.prisma.opportunity.findFirst({ where: { publicCode: input.opportunityCode, deletedAt: null } });
      if (opp) {
        await this.prisma.opportunityActivity.create({
          data: { opportunityId: opp.id, activityType: "BROKER_ORDER_CREATED", payload: { orderCode: order.publicCode }, createdBy: user.sub },
        });
        if (opp.status === "NEW" || opp.status === "CONTACTED") {
          await this.prisma.opportunity.update({ where: { id: opp.id }, data: { status: "NEGOTIATING", wonOrderId: order.id, version: { increment: 1 } } });
        } else {
          await this.prisma.opportunity.update({ where: { id: opp.id }, data: { wonOrderId: order.id, version: { increment: 1 } } });
        }
      }
    }

    // 平台名义通知买家（Broker 不可见买家联系方式，通知服务按 userId 派发）
    const memberships = await this.prisma.membership.findMany({ where: { orgId: buyer.id, deletedAt: null } });
    for (const m of memberships) {
      await this.comm.notifyUser(m.userId, "ORDER_PAYMENT_LINK", {
        orderCode: order.publicCode,
        amount: order.grandTotal.toString(),
        currency: "EUR",
        expiresInHours: INTENT_TTL_HOURS,
        message: "Oussouri 居间专员已为您锁定批次，请在 24 小时内完成托管支付以锁定货权",
      });
    }
    await this.audit.log({
      actorId: user.sub,
      actorRole: user.roles.join(","),
      action: "BROKER_ORDER_CREATE",
      targetType: "TradeOrder",
      targetId: order.id,
      diff: { buyerOrgCode: input.buyerOrgCode, skuCode: input.skuCode, qty: input.qty, unitPriceEur: input.unitPriceEur },
    });
    return { orderCode: order.publicCode, grandTotal: order.grandTotal, expiresInHours: INTENT_TTL_HOURS };
  }

  private async findOpp(code: string) {
    const opp = await this.prisma.opportunity.findFirst({ where: { publicCode: code, deletedAt: null } });
    if (!opp) throw new NotFoundException({ code: "NOT_FOUND", detail: "商机不存在" });
    return opp;
  }
}
