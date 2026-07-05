import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CodeGeneratorService } from "../../kernel/codegen/code-generator.service";
import { OutboxService } from "../../kernel/outbox/outbox.service";

const CHURN_DAYS = 30;

/**
 * 撮合规则引擎（M13，P2 规则版；P3 引入 embedding 相似度与转化率模型）。
 * 规则 A CHURN_RISK×STOCK：30 天未下单的买家 × 其历史购买品类的可售批次
 * 规则 B RFQ×STOCK：进行中 RFQ × 品类/品种匹配且量足的可售批次
 * 幂等：同一 (buyer, supplier, lot, signal) 已有未关闭商机则跳过。
 */
@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly codegen: CodeGeneratorService,
    private readonly outbox: OutboxService,
  ) {}

  @Cron("0 */2 * * *") // 每 2 小时
  async scheduledRun(): Promise<void> {
    try {
      const created = await this.runRules();
      if (created > 0) this.logger.log(`撮合产生 ${created} 条新商机`);
    } catch (err) {
      this.logger.error("撮合任务失败", err instanceof Error ? err.stack : String(err));
    }
  }

  async runRules(): Promise<number> {
    let created = 0;
    created += await this.ruleChurnRisk();
    created += await this.ruleRfqStock();
    return created;
  }

  /** 可售批次（含 SKU/产品上下文） */
  private async availableLots() {
    return this.prisma.inventoryLot.findMany({
      where: { status: "AVAILABLE", deletedAt: null, expiresAt: { gt: new Date() } },
      take: 200,
    });
  }

  private async skuContext(skuIds: string[]) {
    const skus = await this.prisma.productSku.findMany({
      where: { id: { in: skuIds } },
      include: { product: true, priceTiers: { where: { isActive: true, deletedAt: null, currency: "EUR" } } },
    });
    return new Map(skus.map((s) => [s.id, s]));
  }

  private async ruleChurnRisk(): Promise<number> {
    const cutoff = new Date(Date.now() - CHURN_DAYS * 86_400_000);
    // 有历史订单但近 30 天沉默的活跃买家
    const buyers = await this.prisma.organization.findMany({
      where: { partyType: "BUYER", status: "ACTIVE", deletedAt: null },
      take: 100,
    });
    const lots = await this.availableLots();
    if (lots.length === 0) return 0;
    const skuMap = await this.skuContext(lots.map((l) => l.skuId));

    let created = 0;
    for (const buyer of buyers) {
      const lastOrder = await this.prisma.tradeOrder.findFirst({
        where: { buyerOrgId: buyer.id, deletedAt: null, status: { notIn: ["CANCELLED"] } },
        orderBy: { placedAt: "desc" },
      });
      if (!lastOrder?.placedAt || lastOrder.placedAt > cutoff) continue; // 无历史或未流失

      // 偏好 = 历史订单品类/品种
      const pastItems = await this.prisma.orderItem.findMany({ where: { orderId: lastOrder.id, deletedAt: null } });
      const pastSkus = await this.skuContext(pastItems.map((i) => i.skuId));
      const preferredSpecies = new Set([...pastSkus.values()].map((s) => s.product.speciesCode).filter(Boolean));
      const preferredCategories = new Set([...pastSkus.values()].map((s) => s.product.categoryCode));

      for (const lot of lots) {
        const sku = skuMap.get(lot.skuId);
        if (!sku || sku.product.supplierOrgId === buyer.id) continue;
        const speciesHit = sku.product.speciesCode ? preferredSpecies.has(sku.product.speciesCode) : false;
        const categoryHit = preferredCategories.has(sku.product.categoryCode);
        if (!speciesHit && !categoryHit) continue;

        const daysSilent = Math.floor((Date.now() - lastOrder.placedAt.getTime()) / 86_400_000);
        created += await this.createOpportunity({
          buyerOrgId: buyer.id,
          supplierOrgId: sku.product.supplierOrgId,
          lotId: lot.id,
          skuId: sku.id,
          signal: "CHURN_RISK",
          matching: speciesHit ? 90 : 65,
          urgency: Math.min(95, 40 + daysSilent),
          estQtyKg: Number(lot.qtyOnHand) - Number(lot.qtyReserved),
          unitPriceEur: sku.priceTiers[0] ? Number(sku.priceTiers[0].unitPrice) : 0,
          explanation: {
            rule: "CHURN_RISK×STOCK",
            daysSinceLastOrder: daysSilent,
            preferenceHit: speciesHit ? `species:${sku.product.speciesCode}` : `category:${sku.product.categoryCode}`,
            lotExpiresAt: lot.expiresAt.toISOString(),
          },
        });
      }
    }
    return created;
  }

  private async ruleRfqStock(): Promise<number> {
    const rfqs = await this.prisma.rfq.findMany({
      where: { status: { in: ["OPEN", "QUOTING"] }, deadline: { gt: new Date() }, deletedAt: null },
      take: 100,
    });
    if (rfqs.length === 0) return 0;
    const lots = await this.availableLots();
    const skuMap = await this.skuContext(lots.map((l) => l.skuId));

    let created = 0;
    for (const rfq of rfqs) {
      for (const lot of lots) {
        const sku = skuMap.get(lot.skuId);
        if (!sku) continue;
        if (sku.product.categoryCode !== rfq.categoryCode) continue;
        const speciesHit = !rfq.speciesCode || sku.product.speciesCode === rfq.speciesCode;
        if (!speciesHit) continue;
        const available = Number(lot.qtyOnHand) - Number(lot.qtyReserved);
        if (available < Number(rfq.qty)) continue;

        const daysToDeadline = Math.max(0, Math.ceil((rfq.deadline.getTime() - Date.now()) / 86_400_000));
        created += await this.createOpportunity({
          buyerOrgId: rfq.buyerOrgId,
          supplierOrgId: sku.product.supplierOrgId,
          lotId: lot.id,
          skuId: sku.id,
          signal: "RFQ_MATCH",
          matching: rfq.speciesCode ? 95 : 75,
          urgency: Math.min(95, 100 - daysToDeadline * 5),
          estQtyKg: Number(rfq.qty),
          unitPriceEur: sku.priceTiers[0] ? Number(sku.priceTiers[0].unitPrice) : 0,
          explanation: {
            rule: "RFQ×STOCK",
            rfqCode: rfq.publicCode,
            requestedQtyKg: Number(rfq.qty),
            deadline: rfq.deadline.toISOString(),
            targetPrice: rfq.targetPrice ? Number(rfq.targetPrice) : null,
          },
        });
      }
    }
    return created;
  }

  private async createOpportunity(input: {
    buyerOrgId: string;
    supplierOrgId: string;
    lotId: string;
    skuId: string;
    signal: string;
    matching: number;
    urgency: number;
    estQtyKg: number;
    unitPriceEur: number;
    explanation: Prisma.InputJsonValue;
  }): Promise<number> {
    const existing = await this.prisma.opportunity.findFirst({
      where: {
        buyerOrgId: input.buyerOrgId,
        supplierOrgId: input.supplierOrgId,
        lotId: input.lotId,
        sourceSignal: input.signal,
        status: { in: ["NEW", "CONTACTED", "NEGOTIATING"] },
        deletedAt: null,
      },
    });
    if (existing) return 0;

    // 四维评分（Step 2 FR-13-04，权重可配置化列入配置中心待办）
    const estValueEur = input.estQtyKg * input.unitPriceEur;
    const opportunityScore = Math.min(99, Math.round(20 + Math.log10(Math.max(estValueEur, 10)) * 18));
    const profitScore = Math.min(99, Math.round(opportunityScore * 0.9)); // 佣金正比于成交额（P2 简化）

    await this.prisma.$transaction(async (tx) => {
      const code = await this.codegen.next("OPPORTUNITY", tx);
      const opp = await tx.opportunity.create({
        data: {
          publicCode: code,
          buyerOrgId: input.buyerOrgId,
          supplierOrgId: input.supplierOrgId,
          lotId: input.lotId,
          skuId: input.skuId,
          sourceSignal: input.signal,
          matchingScore: new Prisma.Decimal(input.matching),
          opportunityScore: new Prisma.Decimal(opportunityScore),
          urgencyScore: new Prisma.Decimal(input.urgency),
          profitScore: new Prisma.Decimal(profitScore),
          explanation: input.explanation,
          status: "NEW",
        },
      });
      await this.outbox.emitInTx(tx, `Opportunity:${opp.id}`, "OpportunityDetected", {
        opportunityId: opp.id,
        code,
        signal: input.signal,
        urgency: input.urgency,
      });
    });
    return 1;
  }
}
