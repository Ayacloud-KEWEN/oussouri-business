import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CodeGeneratorService } from "../../kernel/codegen/code-generator.service";
import { StateMachineService } from "../../kernel/state-machine/state-machine.service";
import { InventoryService } from "../inventory/inventory.service";
import { pickPriceTier } from "./price-tier.util";
import type { JwtPayload } from "../iam/auth.types";

const SYSTEM_ROLE = "SYSTEM";

@Injectable()
export class TradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codegen: CodeGeneratorService,
    private readonly stateMachine: StateMachineService,
    private readonly inventory: InventoryService,
  ) {}

  // ---------- 购物车 ----------

  async getCart(user: JwtPayload) {
    const cart = await this.ensureCart(user);
    const items = await this.prisma.cartItem.findMany({ where: { cartId: cart.id, deletedAt: null } });
    const skus = await this.prisma.productSku.findMany({
      where: { id: { in: items.map((i) => i.skuId) } },
      select: { id: true, skuCode: true, packSpec: true },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s]));
    return items.map((i) => ({ skuCode: skuMap.get(i.skuId)?.skuCode, packSpec: skuMap.get(i.skuId)?.packSpec, qty: i.qty }));
  }

  async addToCart(skuCode: string, qty: number, user: JwtPayload) {
    const sku = await this.prisma.productSku.findFirst({
      where: { skuCode, status: "ACTIVE", deletedAt: null, product: { status: "ACTIVE", deletedAt: null } },
    });
    if (!sku) throw new NotFoundException({ code: "NOT_FOUND", detail: "SKU 不可购" });
    const cart = await this.ensureCart(user);
    await this.prisma.cartItem.upsert({
      where: { cartId_skuId: { cartId: cart.id, skuId: sku.id } },
      create: { cartId: cart.id, skuId: sku.id, qty: new Prisma.Decimal(qty) },
      update: { qty: new Prisma.Decimal(qty), version: { increment: 1 } },
    });
    return this.getCart(user);
  }

  private async ensureCart(user: JwtPayload) {
    if (!user.orgId) throw new ForbiddenException({ code: "PERM_DENIED", detail: "需要采购商身份" });
    return this.prisma.cart.upsert({
      where: { buyerOrgId: user.orgId },
      create: { buyerOrgId: user.orgId },
      update: {},
    });
  }

  // ---------- 下单（按供应商拆单，BR-08-02；价格/汇率/佣金快照，BR-08-01） ----------

  async placeOrders(input: { items: { skuCode: string; qty: number }[]; currency: string }, user: JwtPayload) {
    if (!user.orgId) throw new ForbiddenException({ code: "PERM_DENIED", detail: "需要采购商身份" });
    const buyerOrg = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
    if (buyerOrg.status !== "ACTIVE") {
      throw new ForbiddenException({ code: "PERM_DENIED", detail: "组织未通过审核" });
    }

    const skus = await this.prisma.productSku.findMany({
      where: { skuCode: { in: input.items.map((i) => i.skuCode) }, status: "ACTIVE", deletedAt: null },
      include: { product: true, priceTiers: { where: { isActive: true, deletedAt: null, currency: input.currency } } },
    });
    if (skus.length !== input.items.length) {
      throw new NotFoundException({ code: "NOT_FOUND", detail: "存在不可购 SKU" });
    }

    const fxRate = await this.fxToEur(input.currency);

    // 按供应商分组
    const groups = new Map<string, { sku: (typeof skus)[number]; qty: Prisma.Decimal }[]>();
    for (const item of input.items) {
      const sku = skus.find((s) => s.skuCode === item.skuCode)!;
      const qty = new Prisma.Decimal(item.qty);
      if (qty.lt(sku.moq)) {
        throw new BadRequestException({ code: "VALIDATION_FAILED", detail: `${sku.skuCode} 低于 MOQ ${sku.moq}` });
      }
      const list = groups.get(sku.product.supplierOrgId) ?? [];
      list.push({ sku, qty });
      groups.set(sku.product.supplierOrgId, list);
    }

    const orders: { code: string; supplierCode: string; grandTotal: string; currency: string }[] = [];
    for (const [supplierOrgId, lines] of groups) {
      const order = await this.prisma.$transaction(async (tx) => {
        const code = await this.codegen.next("ORDER", tx);
        let itemsTotal = new Prisma.Decimal(0);
        const itemRows: Prisma.OrderItemCreateManyInput[] = [];
        for (const { sku, qty } of lines) {
          const tier = pickPriceTier(sku.priceTiers, qty);
          if (!tier) {
            throw new BadRequestException({ code: "VALIDATION_FAILED", detail: `${sku.skuCode} 无适用 ${input.currency} 阶梯价` });
          }
          const lineTotal = tier.unitPrice.mul(qty);
          itemsTotal = itemsTotal.add(lineTotal);
          itemRows.push({
            orderId: "PLACEHOLDER",
            skuId: sku.id,
            qty,
            unitPrice: tier.unitPrice,
            lineTotal,
            snapshot: { skuCode: sku.skuCode, packSpec: sku.packSpec, productName: sku.product.name, productCode: sku.product.publicCode },
          });
        }
        const commissionRate = await this.resolveCommissionRate(tx, lines[0]!.sku.product.categoryCode);
        const commissionAmount = itemsTotal.mul(commissionRate).toDecimalPlaces(2);
        const order = await tx.tradeOrder.create({
          data: {
            publicCode: code,
            orderType: "DIRECT",
            buyerOrgId: user.orgId!,
            supplierOrgId,
            currency: input.currency,
            fxRateToEur: fxRate,
            itemsTotal,
            commissionRate,
            commissionAmount,
            grandTotal: itemsTotal,
            status: "PLACED",
            placedAt: new Date(),
            createdBy: user.sub,
          },
        });
        await tx.orderItem.createMany({ data: itemRows.map((r) => ({ ...r, orderId: order.id })) });
        // 预留库存（订单级，支付前 24h TTL）
        for (const { sku, qty } of lines) {
          await this.inventory.reserveInTx(tx, sku.id, qty, "ORDER", order.id, new Date(Date.now() + 24 * 3600_000), user.sub);
        }
        await this.stateMachine.recordInTx(
          tx, "ORDER", "DRAFT", "PLACED",
          { actorId: user.sub, actorRoles: user.roles, targetType: "TradeOrder", targetId: order.id },
          "OrderPlaced",
          { orderId: order.id, code, buyerOrgId: user.orgId!, supplierOrgId, grandTotal: itemsTotal.toString(), currency: input.currency },
        );
        return order;
      });
      const supplierOrg = await this.prisma.organization.findUniqueOrThrow({ where: { id: supplierOrgId } });
      orders.push({ code: order.publicCode, supplierCode: supplierOrg.publicCode, grandTotal: order.grandTotal.toString(), currency: order.currency });
    }
    // 清空购物车中已下单项
    const cart = await this.prisma.cart.findUnique({ where: { buyerOrgId: user.orgId } });
    if (cart) {
      await this.prisma.cartItem.updateMany({
        where: { cartId: cart.id, skuId: { in: skus.map((s) => s.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return { orders };
  }

  private async fxToEur(currency: string): Promise<Prisma.Decimal> {
    if (currency === "EUR") return new Prisma.Decimal(1);
    const rate = await this.prisma.exchangeRate.findFirst({
      where: { base: "EUR", quote: currency },
      orderBy: { asOf: "desc" },
    });
    if (!rate) throw new BadRequestException({ code: "VALIDATION_FAILED", detail: `无 ${currency} 汇率` });
    return new Prisma.Decimal(1).div(rate.rate).toDecimalPlaces(6);
  }

  private async resolveCommissionRate(tx: Prisma.TransactionClient, categoryCode: string): Promise<Prisma.Decimal> {
    const now = new Date();
    const rules = await tx.commissionRule.findMany({
      where: {
        deletedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: { priority: "desc" },
    });
    const rule = rules.find((r) => r.categoryCode === categoryCode) ?? rules.find((r) => r.categoryCode == null);
    return rule ? rule.ratePct : new Prisma.Decimal("0.08");
  }

  // ---------- 状态迁移（GBR-6：全部走状态机） ----------

  async transition(
    orderCode: string,
    toState: string,
    user: JwtPayload,
    opts: { asSystem?: boolean; reason?: string } = {},
  ) {
    const order = await this.prisma.tradeOrder.findFirst({ where: { publicCode: orderCode, deletedAt: null } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", detail: "订单不存在" });
    this.assertOrderAccess(order, user, opts.asSystem ?? false);
    const roles = opts.asSystem ? [SYSTEM_ROLE, ...user.roles] : user.roles;
    const { emitsEvent } = await this.stateMachine.assertAllowed("ORDER", order.status, toState, roles);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tradeOrder.updateMany({
        where: { id: order.id, version: order.version },
        data: {
          status: toState,
          updatedBy: user.sub,
          version: { increment: 1 },
          ...(toState === "DELIVERED" ? { disputeUntil: new Date(Date.now() + 48 * 3600_000) } : {}),
          ...(toState === "COMPLETED" ? { completedAt: new Date() } : {}),
        },
      });
      if (updated.count === 0) throw new ConflictException({ code: "VERSION_CONFLICT", detail: "订单已被并发修改" });

      // 副作用
      if (toState === "CANCELLED") {
        await this.inventory.releaseInTx(tx, "ORDER", order.id, user.sub);
      }
      if (toState === "SHIPPED") {
        const shipped = await this.inventory.outboundInTx(tx, "ORDER", order.id, user.sub);
        const firstLot = shipped[0];
        if (firstLot) {
          await tx.orderItem.updateMany({ where: { orderId: order.id, lotId: null }, data: { lotId: firstLot.lotId } });
        }
      }
      await this.stateMachine.recordInTx(
        tx, "ORDER", order.status, toState,
        { actorId: user.sub, actorRoles: roles, targetType: "TradeOrder", targetId: order.id, reason: opts.reason },
        emitsEvent,
        { orderId: order.id, code: order.publicCode, from: order.status, to: toState },
      );
    });
    return { code: orderCode, status: toState };
  }

  private assertOrderAccess(order: { buyerOrgId: string; supplierOrgId: string }, user: JwtPayload, asSystem: boolean): void {
    if (asSystem) return;
    const isAdmin = user.roles.some((r) => ["ADMIN", "SUPER_ADMIN", "BROKER", "CUSTOMER_SERVICE"].includes(r));
    if (isAdmin) return;
    if (order.buyerOrgId !== user.orgId && order.supplierOrgId !== user.orgId) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "只能操作本组织订单" });
    }
  }

  // ---------- 查询（可见性：对手方仅代码） ----------

  async listOrders(user: JwtPayload, side: "buyer" | "supplier") {
    const where: Prisma.TradeOrderWhereInput =
      side === "buyer" ? { buyerOrgId: user.orgId ?? "" } : { supplierOrgId: user.orgId ?? "" };
    const orders = await this.prisma.tradeOrder.findMany({
      where: { ...where, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { items: { where: { deletedAt: null } } },
    });
    const counterpartyIds = orders.map((o) => (side === "buyer" ? o.supplierOrgId : o.buyerOrgId));
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: counterpartyIds } },
      select: { id: true, publicCode: true },
    });
    const codeMap = new Map(orgs.map((o) => [o.id, o.publicCode]));
    return orders.map((o) => ({
      code: o.publicCode,
      status: o.status,
      counterpartyCode: codeMap.get(side === "buyer" ? o.supplierOrgId : o.buyerOrgId),
      currency: o.currency,
      grandTotal: o.grandTotal,
      commission: side === "supplier" ? o.commissionAmount : undefined,
      placedAt: o.placedAt,
      items: o.items.map((i) => ({ qty: i.qty, unitPrice: i.unitPrice, lineTotal: i.lineTotal, snapshot: i.snapshot })),
    }));
  }
}
