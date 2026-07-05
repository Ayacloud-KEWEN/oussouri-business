import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CodeGeneratorService } from "../../kernel/codegen/code-generator.service";
import { StateMachineService } from "../../kernel/state-machine/state-machine.service";
import { PiiFilterService } from "../../kernel/pii/pii-filter.service";
import { InventoryService } from "../inventory/inventory.service";
import type { JwtPayload } from "../iam/auth.types";

@Injectable()
export class RfqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codegen: CodeGeneratorService,
    private readonly stateMachine: StateMachineService,
    private readonly piiFilter: PiiFilterService,
    private readonly inventory: InventoryService,
  ) {}

  async create(
    input: { categoryCode: string; speciesCode?: string; packSpec?: string; qty: number; targetPrice?: number; destCountry: string; deadline: string },
    user: JwtPayload,
  ) {
    this.assertNoContact(`${input.packSpec ?? ""}`);
    const rfq = await this.prisma.$transaction(async (tx) => {
      const code = await this.codegen.next("RFQ", tx);
      return tx.rfq.create({
        data: {
          publicCode: code,
          buyerOrgId: user.orgId!,
          categoryCode: input.categoryCode,
          speciesCode: input.speciesCode,
          packSpec: input.packSpec,
          qty: new Prisma.Decimal(input.qty),
          targetPrice: input.targetPrice != null ? new Prisma.Decimal(input.targetPrice) : null,
          destCountry: input.destCountry.toUpperCase(),
          deadline: new Date(input.deadline),
          scope: "BROKERED",
          status: "OPEN",
          createdBy: user.sub,
        },
      });
    });
    return { code: rfq.publicCode, status: rfq.status };
  }

  /** 买家视角：自己的 RFQ + 收到的报价（供应商仅代码） */
  async listForBuyer(user: JwtPayload) {
    const rfqs = await this.prisma.rfq.findMany({
      where: { buyerOrgId: user.orgId ?? "", deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { quotes: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } },
    });
    const supplierIds = [...new Set(rfqs.flatMap((r) => r.quotes.map((q) => q.supplierOrgId)))];
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: supplierIds } }, select: { id: true, publicCode: true } });
    const orgMap = new Map(orgs.map((o) => [o.id, o.publicCode]));
    return rfqs.map((r) => ({
      code: r.publicCode,
      categoryCode: r.categoryCode,
      speciesCode: r.speciesCode,
      qty: r.qty,
      targetPrice: r.targetPrice,
      deadline: r.deadline,
      status: r.status,
      quotes: r.quotes.map((q) => ({
        id: q.id,
        supplierCode: orgMap.get(q.supplierOrgId),
        unitPrice: q.unitPrice,
        moq: q.moq,
        leadTimeDays: q.leadTimeDays,
        validUntil: q.validUntil,
        status: q.status,
      })),
    }));
  }

  /** 供应商视角：可报价的开放 RFQ（买家仅代码；BROKERED 全员可见） */
  async listForSupplier(user: JwtPayload) {
    const rfqs = await this.prisma.rfq.findMany({
      where: { status: { in: ["OPEN", "QUOTING"] }, deadline: { gt: new Date() }, deletedAt: null },
      orderBy: { deadline: "asc" },
    });
    const buyerIds = [...new Set(rfqs.map((r) => r.buyerOrgId))];
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: buyerIds } }, select: { id: true, publicCode: true, countryIso2: true } });
    const orgMap = new Map(orgs.map((o) => [o.id, o]));
    const myQuotes = await this.prisma.quote.findMany({
      where: { supplierOrgId: user.orgId ?? "", rfqId: { in: rfqs.map((r) => r.id) }, deletedAt: null },
    });
    const quoted = new Set(myQuotes.map((q) => q.rfqId));
    return rfqs.map((r) => ({
      code: r.publicCode,
      buyerCode: orgMap.get(r.buyerOrgId)?.publicCode,
      buyerCountry: orgMap.get(r.buyerOrgId)?.countryIso2,
      categoryCode: r.categoryCode,
      speciesCode: r.speciesCode,
      packSpec: r.packSpec,
      qty: r.qty,
      targetPrice: r.targetPrice,
      destCountry: r.destCountry,
      deadline: r.deadline,
      status: r.status,
      alreadyQuoted: quoted.has(r.id),
    }));
  }

  async submitQuote(rfqCode: string, input: { unitPrice: number; moq?: number; leadTimeDays?: number; validDays?: number }, user: JwtPayload) {
    const rfq = await this.findRfq(rfqCode);
    if (rfq.deadline < new Date()) throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "RFQ 已过报价截止" });
    if (rfq.buyerOrgId === user.orgId) throw new ForbiddenException({ code: "PERM_DENIED", detail: "不能对自己的 RFQ 报价" });

    const round = (await this.prisma.quote.count({ where: { rfqId: rfq.id, supplierOrgId: user.orgId!, deletedAt: null } })) + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.quote.create({
        data: {
          rfqId: rfq.id,
          supplierOrgId: user.orgId!,
          round,
          unitPrice: new Prisma.Decimal(input.unitPrice),
          moq: input.moq != null ? new Prisma.Decimal(input.moq) : null,
          leadTimeDays: input.leadTimeDays,
          validUntil: new Date(Date.now() + (input.validDays ?? 7) * 86_400_000),
          status: "SUBMITTED",
          createdBy: user.sub,
        },
      });
      if (rfq.status === "OPEN") {
        const { emitsEvent } = await this.stateMachine.assertAllowed("RFQ", "OPEN", "QUOTING", user.roles);
        await tx.rfq.update({ where: { id: rfq.id }, data: { status: "QUOTING", version: { increment: 1 } } });
        await this.stateMachine.recordInTx(
          tx, "RFQ", "OPEN", "QUOTING",
          { actorId: user.sub, actorRoles: user.roles, targetType: "Rfq", targetId: rfq.id },
          emitsEvent, { rfqId: rfq.id, code: rfqCode },
        );
      }
    });
    return { code: rfqCode, round };
  }

  /** 买家接受报价 → 自动生成 RFQ 订单（预留库存 + 快照） */
  async acceptQuote(quoteId: string, user: JwtPayload) {
    const quote = await this.prisma.quote.findFirst({ where: { id: quoteId, deletedAt: null }, include: { rfq: true } });
    if (!quote) throw new NotFoundException({ code: "NOT_FOUND", detail: "报价不存在" });
    if (quote.rfq.buyerOrgId !== user.orgId) throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织 RFQ" });
    if (quote.validUntil < new Date()) throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "报价已过期" });
    if (quote.rfq.status === "ACCEPTED") throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "该 RFQ 已成交" });

    // 找供应商匹配品类/品种的可售 SKU（P2 简化：报价即视为该供应商对应产品的承诺）
    const sku = await this.prisma.productSku.findFirst({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        product: {
          supplierOrgId: quote.supplierOrgId,
          categoryCode: quote.rfq.categoryCode,
          ...(quote.rfq.speciesCode ? { speciesCode: quote.rfq.speciesCode } : {}),
          status: "ACTIVE",
          deletedAt: null,
        },
      },
      include: { product: true },
    });
    if (!sku) throw new ConflictException({ code: "INVENTORY_INSUFFICIENT", detail: "供应商无匹配的在售产品" });

    const { emitsEvent } = await this.stateMachine.assertAllowed("RFQ", quote.rfq.status, "ACCEPTED", user.roles);
    const qty = quote.rfq.qty;
    const itemsTotal = quote.unitPrice.mul(qty);

    const order = await this.prisma.$transaction(async (tx) => {
      const orderCode = await this.codegen.next("ORDER", tx);
      const commissionRate = new Prisma.Decimal("0.08");
      const order = await tx.tradeOrder.create({
        data: {
          publicCode: orderCode,
          orderType: "RFQ",
          buyerOrgId: quote.rfq.buyerOrgId,
          supplierOrgId: quote.supplierOrgId,
          currency: "EUR",
          fxRateToEur: new Prisma.Decimal(1),
          itemsTotal,
          commissionRate,
          commissionAmount: itemsTotal.mul(commissionRate).toDecimalPlaces(2),
          grandTotal: itemsTotal,
          status: "PLACED",
          placedAt: new Date(),
          notes: `from ${quote.rfq.publicCode}`,
          createdBy: user.sub,
        },
      });
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          skuId: sku.id,
          qty,
          unitPrice: quote.unitPrice,
          lineTotal: itemsTotal,
          snapshot: { skuCode: sku.skuCode, packSpec: sku.packSpec, productName: sku.product.name, productCode: sku.product.publicCode, rfqCode: quote.rfq.publicCode },
        },
      });
      await this.inventory.reserveInTx(tx, sku.id, qty, "ORDER", order.id, new Date(Date.now() + 24 * 3600_000), user.sub);
      await tx.quote.update({ where: { id: quote.id }, data: { status: "ACCEPTED", version: { increment: 1 } } });
      await tx.quote.updateMany({ where: { rfqId: quote.rfq.id, id: { not: quote.id }, status: "SUBMITTED" }, data: { status: "REJECTED" } });
      await tx.rfq.update({ where: { id: quote.rfq.id }, data: { status: "ACCEPTED", version: { increment: 1 } } });
      await this.stateMachine.recordInTx(
        tx, "RFQ", quote.rfq.status, "ACCEPTED",
        { actorId: user.sub, actorRoles: user.roles, targetType: "Rfq", targetId: quote.rfq.id },
        emitsEvent, { rfqId: quote.rfq.id, orderCode },
      );
      await this.stateMachine.recordInTx(
        tx, "ORDER", "DRAFT", "PLACED",
        { actorId: user.sub, actorRoles: user.roles, targetType: "TradeOrder", targetId: order.id, reason: "rfq accepted" },
        "OrderPlaced", { orderId: order.id, code: orderCode },
      );
      return order;
    });
    return { orderCode: order.publicCode, grandTotal: order.grandTotal };
  }

  private async findRfq(code: string) {
    const rfq = await this.prisma.rfq.findFirst({ where: { publicCode: code, deletedAt: null } });
    if (!rfq) throw new NotFoundException({ code: "NOT_FOUND", detail: "RFQ 不存在" });
    return rfq;
  }

  private assertNoContact(text: string): void {
    if (this.piiFilter.scan(text).length > 0) {
      throw new ForbiddenException({ code: "PII_BLOCKED", detail: "RFQ 内容不得包含联系方式" });
    }
  }
}
