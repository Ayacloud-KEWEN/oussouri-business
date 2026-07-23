import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import type { JwtPayload } from "../iam/auth.types";

/**
 * 库存服务（M05）：余额 = 流水聚合的缓存；所有变更走事务 + 行锁，
 * 超卖由 migration 中的 CHECK 约束兜底。
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async inbound(
    input: { skuCode: string; lotNo: string; qty: number; producedAt: string; expiresAt: string; warehouse?: string; processingBatchNo?: string },
    user: JwtPayload,
  ) {
    const sku = await this.prisma.productSku.findFirst({
      where: { skuCode: input.skuCode, deletedAt: null },
      include: { product: true },
    });
    if (!sku) throw new NotFoundException({ code: "NOT_FOUND", detail: "SKU 不存在" });
    if (sku.product.supplierOrgId !== user.orgId) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "只能操作本组织库存" });
    }
    // 溯源链（BR-02-01）：入库可关联本组织加工批次
    let processingBatchId: string | null = null;
    if (input.processingBatchNo) {
      const batch = await this.prisma.processingBatch.findFirst({
        where: { supplierOrgId: user.orgId!, batchNo: input.processingBatchNo, deletedAt: null },
      });
      if (!batch) throw new NotFoundException({ code: "NOT_FOUND", detail: "加工批次不存在" });
      if (batch.qcStatus === "QC_FAIL") {
        throw new ConflictException({ code: "STATE_GUARD_FAILED", detail: "质检不合格的加工批次不能入库" });
      }
      processingBatchId = batch.id;
    }
    return this.prisma.$transaction(async (tx) => {
      const lot = await tx.inventoryLot.upsert({
        where: { skuId_lotNo: { skuId: sku.id, lotNo: input.lotNo } },
        create: {
          skuId: sku.id,
          processingBatchId,
          lotNo: input.lotNo,
          producedAt: new Date(input.producedAt),
          expiresAt: new Date(input.expiresAt),
          warehouse: input.warehouse,
          qtyOnHand: new Prisma.Decimal(input.qty),
          createdBy: user.sub,
        },
        update: { qtyOnHand: { increment: new Prisma.Decimal(input.qty) }, version: { increment: 1 } },
      });
      await tx.inventoryTransaction.create({
        data: { lotId: lot.id, txType: "INBOUND", qty: new Prisma.Decimal(input.qty), createdBy: user.sub },
      });
      return { lotNo: lot.lotNo, qtyOnHand: lot.qtyOnHand };
    });
  }

  /** 预留（FIFO 按效期），在调用方事务内使用；返回预留分配明细 */
  async reserveInTx(
    tx: Prisma.TransactionClient,
    skuId: string,
    qty: Prisma.Decimal,
    refType: string,
    refId: string,
    expiresAt: Date | null,
    actorId: string,
  ): Promise<{ lotId: string; qty: Prisma.Decimal }[]> {
    const lots = await tx.$queryRaw<{ id: string; qtyOnHand: Prisma.Decimal; qtyReserved: Prisma.Decimal }[]>`
      SELECT id, "qtyOnHand", "qtyReserved" FROM core.inventory_lots
      WHERE "skuId" = ${skuId}::uuid AND status = 'AVAILABLE' AND "deletedAt" IS NULL AND "expiresAt" > now()
      ORDER BY "expiresAt" ASC
      FOR UPDATE`;
    let remaining = new Prisma.Decimal(qty);
    const allocations: { lotId: string; qty: Prisma.Decimal }[] = [];
    for (const lot of lots) {
      if (remaining.lte(0)) break;
      const available = new Prisma.Decimal(lot.qtyOnHand).minus(lot.qtyReserved);
      if (available.lte(0)) continue;
      const take = Prisma.Decimal.min(available, remaining);
      allocations.push({ lotId: lot.id, qty: take });
      remaining = remaining.minus(take);
    }
    if (remaining.gt(0)) {
      throw new ConflictException({ code: "INVENTORY_INSUFFICIENT", detail: `库存不足，缺 ${remaining.toString()}` });
    }
    for (const alloc of allocations) {
      await tx.inventoryLot.update({
        where: { id: alloc.lotId },
        data: { qtyReserved: { increment: alloc.qty }, version: { increment: 1 } },
      });
      await tx.reservation.create({
        data: { lotId: alloc.lotId, qty: alloc.qty, refType, refId, expiresAt, createdBy: actorId },
      });
      await tx.inventoryTransaction.create({
        data: { lotId: alloc.lotId, txType: "RESERVE", qty: alloc.qty, refType, refId, createdBy: actorId },
      });
    }
    return allocations;
  }

  /** 释放预留（取消/超时） */
  async releaseInTx(tx: Prisma.TransactionClient, refType: string, refId: string, actorId: string): Promise<void> {
    const reservations = await tx.reservation.findMany({ where: { refType, refId, status: "HELD", deletedAt: null } });
    for (const r of reservations) {
      // updateMany 而非 update：批次可能已不存在（历史清理留下的孤儿预留）。
      // 用 update 会抛 P2025 中断整个事务 —— 对超时回收这种批量任务，
      // 一条坏数据就会拖垮所有人的释放。批次没了本就不占库存，跳过即可，
      // 预留仍照常标记 RELEASED，避免它永远卡在 HELD 被反复扫到。
      const touched = await tx.inventoryLot.updateMany({
        where: { id: r.lotId },
        data: { qtyReserved: { decrement: r.qty }, version: { increment: 1 } },
      });
      if (touched.count === 0) {
        this.logger.warn(`预留 ${r.id} 指向的批次 ${r.lotId} 已不存在，仅标记释放`);
      }
      await tx.reservation.update({ where: { id: r.id }, data: { status: "RELEASED", version: { increment: 1 } } });
      await tx.inventoryTransaction.create({
        data: { lotId: r.lotId, txType: "RELEASE", qty: r.qty.neg(), refType, refId, createdBy: actorId },
      });
    }
  }

  /** 出库（发货）：消耗预留 → 扣减在库 */
  async outboundInTx(tx: Prisma.TransactionClient, refType: string, refId: string, actorId: string): Promise<{ lotId: string; qty: Prisma.Decimal }[]> {
    const reservations = await tx.reservation.findMany({ where: { refType, refId, status: "HELD", deletedAt: null } });
    if (reservations.length === 0) {
      throw new ConflictException({ code: "INVENTORY_INSUFFICIENT", detail: "无有效预留可出库" });
    }
    const shipped: { lotId: string; qty: Prisma.Decimal }[] = [];
    for (const r of reservations) {
      await tx.inventoryLot.update({
        where: { id: r.lotId },
        data: {
          qtyOnHand: { decrement: r.qty },
          qtyReserved: { decrement: r.qty },
          version: { increment: 1 },
        },
      });
      await tx.reservation.update({ where: { id: r.id }, data: { status: "CONSUMED", version: { increment: 1 } } });
      await tx.inventoryTransaction.create({
        data: { lotId: r.lotId, txType: "OUTBOUND", qty: r.qty.neg(), refType, refId, createdBy: actorId },
      });
      shipped.push({ lotId: r.lotId, qty: r.qty });
    }
    return shipped;
  }

  async listSupplierLots(user: JwtPayload) {
    // 跨聚合无 relation（模块解耦）：先取本组织 SKU，再查批次
    const skus = await this.prisma.productSku.findMany({
      where: { deletedAt: null, product: { supplierOrgId: user.orgId ?? "", deletedAt: null } },
      select: { id: true, skuCode: true },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s.skuCode]));
    const lots = await this.prisma.inventoryLot.findMany({
      where: { deletedAt: null, skuId: { in: [...skuMap.keys()] } },
      orderBy: { expiresAt: "asc" },
    });
    return lots.map((l) => ({
      skuCode: skuMap.get(l.skuId),
      lotNo: l.lotNo,
      qtyOnHand: l.qtyOnHand,
      qtyReserved: l.qtyReserved,
      expiresAt: l.expiresAt,
      status: l.status,
    }));
  }
}
