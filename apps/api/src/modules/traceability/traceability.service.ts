import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CryptoService } from "../../kernel/crypto/crypto.service";
import { AuditService } from "../../kernel/audit/audit.service";
import type { JwtPayload } from "../iam/auth.types";

/**
 * 溯源域（M02 FR-02-02，行业无关）：
 * 产源单元 → 子单元 → 原料批次 → 养护记录 → 加工批次（休药期守卫）→ 库存批次。
 * 基地名/位置加密存储（可反推供应商身份，GBR-1）。
 */
@Injectable()
export class TraceabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ---------- 产源单元 ----------

  async createUnit(
    input: { unitType: string; name: string; location: string; countryIso2: string; attributes?: Record<string, unknown> },
    user: JwtPayload,
  ) {
    this.assertSupplier(user);
    const unit = await this.prisma.productionUnit.create({
      data: {
        supplierOrgId: user.orgId!,
        unitType: input.unitType,
        nameEnc: this.crypto.encrypt(input.name),
        locationEnc: this.crypto.encrypt(input.location),
        countryIso2: input.countryIso2.toUpperCase(),
        attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
        createdBy: user.sub,
      },
    });
    return { unitId: unit.id, unitType: unit.unitType };
  }

  async listUnits(user: JwtPayload) {
    this.assertSupplier(user);
    const units = await this.prisma.productionUnit.findMany({ where: { supplierOrgId: user.orgId!, deletedAt: null } });
    // 本组织可见自己的真实基地名
    return units.map((u) => ({
      unitId: u.id,
      unitType: u.unitType,
      name: this.crypto.decrypt(u.nameEnc),
      location: this.crypto.decrypt(u.locationEnc),
      countryIso2: u.countryIso2,
      attributes: u.attributes,
      status: u.status,
    }));
  }

  async createSubunit(unitId: string, input: { name: string; attributes?: Record<string, unknown> }, user: JwtPayload) {
    const unit = await this.ownedUnit(unitId, user);
    const subunit = await this.prisma.productionSubunit.create({
      data: { unitId: unit.id, name: input.name, attributes: (input.attributes ?? {}) as Prisma.InputJsonValue, createdBy: user.sub },
    });
    return { subunitId: subunit.id, name: subunit.name };
  }

  // ---------- 原料批次与养护 ----------

  async createSourceBatch(
    input: { subunitId: string; batchNo: string; speciesCode?: string; quantity?: number; avgWeightKg?: number; ageMonths?: number; originType?: string; rfidStart?: string; rfidEnd?: string },
    user: JwtPayload,
  ) {
    const subunit = await this.prisma.productionSubunit.findFirst({ where: { id: input.subunitId, deletedAt: null } });
    if (!subunit) throw new NotFoundException({ code: "NOT_FOUND", detail: "子单元不存在" });
    await this.ownedUnit(subunit.unitId, user);
    const batch = await this.prisma.sourceBatch.create({
      data: {
        subunitId: subunit.id,
        batchNo: input.batchNo,
        speciesCode: input.speciesCode,
        quantity: input.quantity,
        avgWeightKg: input.avgWeightKg != null ? new Prisma.Decimal(input.avgWeightKg) : null,
        ageMonths: input.ageMonths,
        originType: input.originType,
        rfidStart: input.rfidStart,
        rfidEnd: input.rfidEnd,
        createdBy: user.sub,
      },
    });
    return { sourceBatchId: batch.id, batchNo: batch.batchNo };
  }

  async addCareRecord(
    sourceBatchId: string,
    input: { recordType: "FEEDING" | "HEALTH" | "MEDICATION" | "MORTALITY"; recordDate: string; payload: Record<string, unknown>; withdrawalUntil?: string; operator?: string },
    user: JwtPayload,
  ) {
    await this.ownedSourceBatch(sourceBatchId, user);
    if (input.recordType === "MEDICATION" && !input.withdrawalUntil) {
      throw new ConflictException({ code: "VALIDATION_FAILED", detail: "用药记录必须填写休药期截止日（withdrawalUntil）" });
    }
    const record = await this.prisma.careRecord.create({
      data: {
        sourceBatchId,
        recordType: input.recordType,
        recordDate: new Date(input.recordDate),
        payload: input.payload as Prisma.InputJsonValue,
        withdrawalUntil: input.withdrawalUntil ? new Date(input.withdrawalUntil) : null,
        operator: input.operator,
        createdBy: user.sub,
      },
    });
    return { recordId: record.id, recordType: record.recordType };
  }

  // ---------- 加工批次（休药期守卫，BR-02-01） ----------

  async createProcessingBatch(
    input: {
      sourceBatchId?: string;
      batchNo: string;
      categoryCode: string;
      speciesCode?: string;
      rawWeightKg: number;
      outputWeightKg: number;
      processedAt: string;
      steps?: { stepCode: string; temperature?: number; operator?: string }[];
      attributes?: Record<string, unknown>;
    },
    user: JwtPayload,
  ) {
    this.assertSupplier(user);
    if (input.sourceBatchId) {
      await this.ownedSourceBatch(input.sourceBatchId, user);
      // 休药期守卫：来源批次存在未过期休药期则禁止加工
      const activeWithdrawal = await this.prisma.careRecord.findFirst({
        where: { sourceBatchId: input.sourceBatchId, recordType: "MEDICATION", withdrawalUntil: { gt: new Date() }, deletedAt: null },
      });
      if (activeWithdrawal) {
        throw new ConflictException({
          code: "STATE_GUARD_FAILED",
          detail: `原料批次处于休药期（至 ${activeWithdrawal.withdrawalUntil!.toISOString().slice(0, 10)}），禁止加工`,
        });
      }
    }
    const batch = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.processingBatch.create({
        data: {
          supplierOrgId: user.orgId!,
          sourceBatchId: input.sourceBatchId,
          batchNo: input.batchNo,
          categoryCode: input.categoryCode,
          speciesCode: input.speciesCode,
          rawWeightKg: new Prisma.Decimal(input.rawWeightKg),
          outputWeightKg: new Prisma.Decimal(input.outputWeightKg),
          processedAt: new Date(input.processedAt),
          attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
          createdBy: user.sub,
        },
      });
      if (input.steps?.length) {
        await tx.processingStep.createMany({
          data: input.steps.map((s, i) => ({
            processingBatchId: batch.id,
            stepCode: s.stepCode,
            temperature: s.temperature != null ? new Prisma.Decimal(s.temperature) : null,
            operator: s.operator,
            sortOrder: i + 1,
          })),
        });
      }
      await this.audit.logInTx(tx, { actorId: user.sub, action: "CREATE", targetType: "ProcessingBatch", targetId: batch.id, diff: { batchNo: input.batchNo } });
      return batch;
    });
    return { processingBatchId: batch.id, batchNo: batch.batchNo, qcStatus: batch.qcStatus };
  }

  async setQc(processingBatchId: string, qcStatus: "QC_PASS" | "QC_FAIL", user: JwtPayload, notes?: string) {
    const batch = await this.prisma.processingBatch.findFirst({ where: { id: processingBatchId, deletedAt: null } });
    if (!batch) throw new NotFoundException({ code: "NOT_FOUND", detail: "加工批次不存在" });
    await this.prisma.processingBatch.update({
      where: { id: processingBatchId },
      data: { qcStatus, updatedBy: user.sub, version: { increment: 1 } },
    });
    await this.audit.log({ actorId: user.sub, actorRole: user.roles.join(","), action: "QC_DECISION", targetType: "ProcessingBatch", targetId: processingBatchId, diff: { qcStatus }, reason: notes });
    return { processingBatchId, qcStatus };
  }

  async listProcessingBatches(user: JwtPayload) {
    this.assertSupplier(user);
    const batches = await this.prisma.processingBatch.findMany({
      where: { supplierOrgId: user.orgId!, deletedAt: null },
      orderBy: { processedAt: "desc" },
      include: { steps: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
    return batches.map((b) => ({
      processingBatchId: b.id,
      batchNo: b.batchNo,
      categoryCode: b.categoryCode,
      speciesCode: b.speciesCode,
      rawWeightKg: b.rawWeightKg,
      outputWeightKg: b.outputWeightKg,
      processedAt: b.processedAt,
      qcStatus: b.qcStatus,
      steps: b.steps.map((s) => s.stepCode),
    }));
  }

  // ---------- 公开脱敏溯源视图（M01 FR-01-03） ----------

  async publicTrace(productCode: string) {
    const product = await this.prisma.product.findFirst({ where: { publicCode: productCode, status: "ACTIVE", deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", detail: "产品不存在" });
    const skus = await this.prisma.productSku.findMany({ where: { productId: product.id, deletedAt: null }, select: { id: true } });
    const lot = await this.prisma.inventoryLot.findFirst({
      where: { skuId: { in: skus.map((s) => s.id) }, processingBatchId: { not: null }, deletedAt: null },
      orderBy: { producedAt: "desc" },
    });
    if (!lot?.processingBatchId) return { productCode, chain: null };
    const processing = await this.prisma.processingBatch.findUnique({
      where: { id: lot.processingBatchId },
      include: { steps: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
    if (!processing) return { productCode, chain: null };
    let source: { speciesCode: string | null; ageMonths: number | null; originType: string | null; countryIso2: string | null } | null = null;
    if (processing.sourceBatchId) {
      const sourceBatch = await this.prisma.sourceBatch.findUnique({ where: { id: processing.sourceBatchId } });
      if (sourceBatch) {
        const subunit = await this.prisma.productionSubunit.findUnique({ where: { id: sourceBatch.subunitId } });
        const unit = subunit ? await this.prisma.productionUnit.findUnique({ where: { id: subunit.unitId } }) : null;
        // 脱敏：只给国家/品种/鱼龄/来源类型，不给基地名/位置/企业信息
        source = {
          speciesCode: sourceBatch.speciesCode,
          ageMonths: sourceBatch.ageMonths,
          originType: sourceBatch.originType,
          countryIso2: unit?.countryIso2 ?? null,
        };
      }
    }
    return {
      productCode,
      chain: {
        source,
        processing: {
          processedAt: processing.processedAt,
          qcStatus: processing.qcStatus,
          steps: processing.steps.map((s) => s.stepCode),
          yieldPct: processing.rawWeightKg.gt(0)
            ? processing.outputWeightKg.div(processing.rawWeightKg).mul(100).toDecimalPlaces(1)
            : null,
        },
        lot: { producedAt: lot.producedAt, expiresAt: lot.expiresAt },
      },
    };
  }

  // ---------- helpers ----------

  private async ownedUnit(unitId: string, user: JwtPayload) {
    this.assertSupplier(user);
    const unit = await this.prisma.productionUnit.findFirst({ where: { id: unitId, deletedAt: null } });
    if (!unit) throw new NotFoundException({ code: "NOT_FOUND", detail: "产源单元不存在" });
    if (unit.supplierOrgId !== user.orgId) throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织" });
    return unit;
  }

  private async ownedSourceBatch(sourceBatchId: string, user: JwtPayload) {
    const batch = await this.prisma.sourceBatch.findFirst({ where: { id: sourceBatchId, deletedAt: null } });
    if (!batch) throw new NotFoundException({ code: "NOT_FOUND", detail: "原料批次不存在" });
    const subunit = await this.prisma.productionSubunit.findUniqueOrThrow({ where: { id: batch.subunitId } });
    await this.ownedUnit(subunit.unitId, user);
    return batch;
  }

  private assertSupplier(user: JwtPayload): void {
    if (!user.orgId || !user.roles.includes("SUPPLIER")) {
      throw new ForbiddenException({ code: "PERM_DENIED", detail: "需要供应商身份" });
    }
  }
}
