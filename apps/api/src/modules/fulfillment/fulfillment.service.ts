import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { StateMachineService } from "../../kernel/state-machine/state-machine.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { CommunicationService } from "../communication/communication.service";
import { StoragePort } from "../files/storage.port";
import type { JwtPayload } from "../iam/auth.types";

export interface ShipmentLegInput {
  mode: "AIR" | "SEA" | "ROAD" | "RAIL" | "COLD_CHAIN_LAST_MILE";
  carrier: string;
  waybillNo?: string;
  fromCode: string;
  toCode: string;
}

/** 冷链默认阈值（℃）：初稿 §14.3 鱼子酱 -2~0；SKU 级阈值 P2.4 接入 */
const DEFAULT_TEMP_MIN = -2;
const DEFAULT_TEMP_MAX = 2;

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: StateMachineService,
    private readonly audit: AuditService,
    private readonly comm: CommunicationService,
    private readonly storage: StoragePort,
  ) {}

  // ---------- 运单（M10） ----------

  async registerShipment(
    orderCode: string,
    input: { incoterms?: string; packages?: number; grossWeightKg?: number; legs: ShipmentLegInput[] },
    user: JwtPayload,
  ) {
    const order = await this.findOrder(orderCode);
    if (order.supplierOrgId !== user.orgId && !this.isStaff(user)) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织订单" });
    }
    if (!["PAID_ESCROW", "CONFIRMED", "PREPARING"].includes(order.status)) {
      throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "订单当前不可登记运单" });
    }
    const existing = await this.prisma.shipment.findFirst({ where: { orderId: order.id, deletedAt: null } });
    const shipment = await this.prisma.$transaction(async (tx) => {
      const shipment = existing
        ? await tx.shipment.update({
            where: { id: existing.id },
            data: {
              incoterms: input.incoterms,
              packages: input.packages,
              grossWeightKg: input.grossWeightKg != null ? new Prisma.Decimal(input.grossWeightKg) : undefined,
              updatedBy: user.sub,
              version: { increment: 1 },
            },
          })
        : await tx.shipment.create({
            data: {
              orderId: order.id,
              incoterms: input.incoterms,
              packages: input.packages,
              grossWeightKg: input.grossWeightKg != null ? new Prisma.Decimal(input.grossWeightKg) : null,
              status: "PREPARING",
              createdBy: user.sub,
            },
          });
      if (existing) await tx.shipmentLeg.deleteMany({ where: { shipmentId: shipment.id } });
      await tx.shipmentLeg.createMany({
        data: input.legs.map((leg, i) => ({
          shipmentId: shipment.id,
          seq: i + 1,
          mode: leg.mode,
          carrier: leg.carrier,
          waybillNo: leg.waybillNo,
          fromCode: leg.fromCode.toUpperCase(),
          toCode: leg.toCode.toUpperCase(),
          status: "PREPARING",
        })),
      });
      await this.audit.logInTx(tx, { actorId: user.sub, action: "SHIPMENT_REGISTER", targetType: "Shipment", targetId: shipment.id, diff: { legs: input.legs.length } });
      return shipment;
    });
    return { shipmentId: shipment.id, legs: input.legs.length, status: shipment.status };
  }

  async getShipment(orderCode: string, user: JwtPayload) {
    const order = await this.findOrder(orderCode);
    if (order.supplierOrgId !== user.orgId && order.buyerOrgId !== user.orgId && !this.isStaff(user)) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织订单" });
    }
    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId: order.id, deletedAt: null },
      include: { legs: { where: { deletedAt: null }, orderBy: { seq: "asc" } } },
    });
    if (!shipment) return null;
    // 温度明细供履约页画冷链曲线（R1.6-1）；上限 200 条防止长航程刷屏
    const temperatures = await this.prisma.temperatureLog.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { recordedAt: "asc" },
      take: 200,
      select: { recordedAt: true, tempC: true, breached: true, source: true },
    });
    return {
      status: shipment.status,
      incoterms: shipment.incoterms,
      packages: shipment.packages,
      grossWeightKg: shipment.grossWeightKg,
      legs: shipment.legs.map((l) => ({
        seq: l.seq, mode: l.mode, carrier: l.carrier, waybillNo: l.waybillNo,
        fromCode: l.fromCode, toCode: l.toCode, status: l.status,
        departAt: l.departAt, arriveAt: l.arriveAt,
      })),
      temperatures,
      temperatureBreaches: temperatures.filter((t) => t.breached).length,
    };
  }

  /** 发货时（订单 SHIPPED）同事务把运单转 IN_TRANSIT（供 TradingService 调用） */
  async markInTransitInTx(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.shipment.updateMany({ where: { orderId, deletedAt: null }, data: { status: "IN_TRANSIT", version: { increment: 1 } } });
    await tx.shipmentLeg.updateMany({ where: { shipment: { orderId } }, data: { status: "IN_TRANSIT" } });
  }

  // ---------- 冷链温度日志 ----------

  async addTemperatureLogs(
    orderCode: string,
    entries: { recordedAt: string; tempC: number }[],
    user: JwtPayload,
  ) {
    const order = await this.findOrder(orderCode);
    if (order.supplierOrgId !== user.orgId && !this.isStaff(user)) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织订单" });
    }
    const shipment = await this.prisma.shipment.findFirst({ where: { orderId: order.id, deletedAt: null } });
    if (!shipment) throw new NotFoundException({ code: "NOT_FOUND", detail: "运单未登记" });

    const rows = entries.map((e) => ({
      shipmentId: shipment.id,
      recordedAt: new Date(e.recordedAt),
      tempC: new Prisma.Decimal(e.tempC),
      source: "API",
      breached: e.tempC < DEFAULT_TEMP_MIN || e.tempC > DEFAULT_TEMP_MAX,
    }));
    await this.prisma.temperatureLog.createMany({ data: rows });
    const breachCount = rows.filter((r) => r.breached).length;

    if (breachCount > 0) {
      // 超阈告警：审计 + 通知买家（争议证据链，M10 FR-10-02）
      await this.audit.log({
        actorId: user.sub,
        action: "COLD_CHAIN_BREACH",
        targetType: "Shipment",
        targetId: shipment.id,
        diff: { breachCount, thresholds: { min: DEFAULT_TEMP_MIN, max: DEFAULT_TEMP_MAX } },
      });
      const memberships = await this.prisma.membership.findMany({ where: { orgId: order.buyerOrgId, deletedAt: null } });
      for (const m of memberships) {
        await this.comm.notifyUser(m.userId, "TEMP_BREACH", { orderCode, breachCount });
      }
    }
    return { logged: rows.length, breaches: breachCount };
  }

  // ---------- 单证与齐备度（M12 子集） ----------

  async registerDocument(
    input: { docType: string; docNo?: string; orderCode: string; issuer?: string; issueDate?: string; expiryDate?: string },
    user: JwtPayload,
  ) {
    const order = await this.findOrder(input.orderCode);
    if (order.supplierOrgId !== user.orgId && !this.isStaff(user)) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织订单" });
    }
    const doc = await this.prisma.document.create({
      data: {
        docType: input.docType,
        docNo: input.docNo,
        ownerOrgId: order.supplierOrgId,
        refType: "ORDER",
        refId: order.id,
        issuer: input.issuer,
        issueDate: input.issueDate ? new Date(input.issueDate) : undefined,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
        // P2.3 接 S3 预签名直传；当前登记元数据
        fileKey: `pending-upload/${input.docType.toLowerCase()}`,
        createdBy: user.sub,
      },
    });
    return { documentId: doc.id, docType: doc.docType };
  }

  async docChecklist(orderCode: string, user: JwtPayload) {
    const order = await this.findOrder(orderCode);
    if (order.supplierOrgId !== user.orgId && order.buyerOrgId !== user.orgId && !this.isStaff(user)) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织订单" });
    }
    return this.buildChecklist(order);
  }

  private async buildChecklist(order: { id: string; buyerOrgId: string; supplierOrgId: string }) {
    const [buyerOrg, supplierOrg] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: order.buyerOrgId }, select: { countryIso2: true } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: order.supplierOrgId }, select: { countryIso2: true } }),
    ]);
    const item = await this.prisma.orderItem.findFirst({ where: { orderId: order.id, deletedAt: null } });
    let categoryCode = "CAVIAR";
    if (item) {
      const sku = await this.prisma.productSku.findUnique({ where: { id: item.skuId }, include: { product: { select: { categoryCode: true } } } });
      if (sku) categoryCode = sku.product.categoryCode;
    }
    const template = await this.prisma.docRequirementTemplate.findFirst({
      where: { categoryCode, exportCountry: supplierOrg.countryIso2, importCountry: buyerOrg.countryIso2, deletedAt: null },
    });
    const required = template?.requiredDocTypes ?? [];
    const docs = await this.prisma.document.findMany({
      where: { refType: "ORDER", refId: order.id, deletedAt: null, status: { not: "REJECTED" } },
      select: { docType: true, docNo: true },
    });
    const present = [...new Set(docs.map((d) => d.docType))];
    const missing = required.filter((r) => !present.includes(r));
    return { categoryCode, exportCountry: supplierOrg.countryIso2, importCountry: buyerOrg.countryIso2, required, present, missing, complete: missing.length === 0 && required.length > 0 };
  }

  /** 发货守卫（BR：单证缺件不允许 SHIPPED；由 TradingService 在迁移前调用） */
  async assertReadyToShip(orderId: string): Promise<void> {
    const order = await this.prisma.tradeOrder.findUniqueOrThrow({ where: { id: orderId } });
    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId, deletedAt: null },
      include: { legs: { where: { deletedAt: null } } },
    });
    if (!shipment || shipment.legs.length === 0) {
      throw new ConflictException({ code: "DOC_CHECKLIST_INCOMPLETE", detail: "发货前须登记运单（至少一段运输）" });
    }
    const checklist = await this.buildChecklist(order);
    if (checklist.required.length > 0 && !checklist.complete) {
      throw new ConflictException({
        code: "DOC_CHECKLIST_INCOMPLETE",
        detail: `单证缺件：${checklist.missing.join(", ")}`,
        missing: checklist.missing,
      });
    }
  }

  // ---------- 单证脱敏发送（M12 FR-12-02/12-03，P2.3） ----------

  /** 登记遮盖模板（新单证类型首次人工标注遮盖区，BR-12-01） */
  async setMaskTemplate(documentId: string, regions: { page: number; x: number; y: number; w: number; h: number; label: string }[], user: JwtPayload) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
    if (!doc) throw new NotFoundException({ code: "NOT_FOUND", detail: "单证不存在" });
    await this.prisma.document.update({
      where: { id: documentId },
      data: { maskTemplate: { regions } as Prisma.InputJsonValue, updatedBy: user.sub, version: { increment: 1 } },
    });
    await this.audit.log({ actorId: user.sub, action: "MASK_TEMPLATE_SET", targetType: "Document", targetId: documentId, diff: { regions: regions.length } });
    return { documentId, regions: regions.length };
  }

  /**
   * 生成脱敏副本并发送到对方平台档案：遮盖公章/厂名区域 + 平台水印 + 唯一追踪码。
   * 原件永不外发；副本可追踪（谁生成/发给谁/何时）。
   * PDF 像素级遮盖渲染由 worker 异步处理（P3）；本阶段落地元数据流与档案送达。
   */
  async createMaskedCopy(documentId: string, toOrgCode: string, user: JwtPayload) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
    if (!doc) throw new NotFoundException({ code: "NOT_FOUND", detail: "单证不存在" });
    if (!doc.maskTemplate) {
      throw new ConflictException({ code: "VALIDATION_FAILED", detail: "该单证尚未标注遮盖模板，禁止外发（BR-12-01）" });
    }
    const toOrg = await this.prisma.organization.findFirst({ where: { publicCode: toOrgCode, deletedAt: null } });
    if (!toOrg) throw new NotFoundException({ code: "NOT_FOUND", detail: "接收方不存在" });

    const trackingCode = `TRK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const copy = await this.prisma.maskedDocumentCopy.create({
      data: {
        documentId: doc.id,
        trackingCode,
        generatedBy: user.sub,
        sentToOrgId: toOrg.id,
        fileKey: `masked/${trackingCode}.pdf`,
        sentAt: new Date(),
      },
    });
    await this.audit.log({
      actorId: user.sub,
      actorRole: user.roles.join(","),
      action: "MASKED_DOC_SENT",
      targetType: "Document",
      targetId: doc.id,
      diff: { trackingCode, toOrgCode, docType: doc.docType },
    });
    const memberships = await this.prisma.membership.findMany({ where: { orgId: toOrg.id, deletedAt: null } });
    for (const m of memberships) {
      await this.comm.notifyUser(m.userId, "DOC_RECEIVED", { docType: doc.docType, trackingCode, docNo: doc.docNo });
    }
    return { trackingCode, copyId: copy.id, docType: doc.docType };
  }

  // ---------- 单证原件上传/下载（R1-3，私有通道） ----------

  /** 上传原件：仅单证所属供应商与内部角色；对象键含订单与单证 id，避免枚举 */
  async uploadDocumentFile(
    documentId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    user: JwtPayload,
  ) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
    if (!doc) throw new NotFoundException({ code: "NOT_FOUND", detail: "单证不存在" });
    if (doc.ownerOrgId !== user.orgId && !this.isStaff(user)) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织单证" });
    }
    const ext = (file.originalname.split(".").pop() ?? "bin").toLowerCase();
    if (!["pdf", "jpg", "jpeg", "png", "webp"].includes(ext)) {
      throw new ConflictException({ code: "VALIDATION_FAILED", detail: "仅支持 PDF/JPG/PNG/WebP" });
    }
    const key = `documents/${doc.refId ?? "misc"}/${doc.id}.${ext}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    await this.prisma.document.update({ where: { id: doc.id }, data: { fileKey: key, updatedBy: user.sub, version: { increment: 1 } } });
    await this.audit.log({
      actorId: user.sub, actorRole: user.roles.join(","), action: "DOC_FILE_UPLOADED",
      targetType: "Document", targetId: doc.id, diff: { key, bytes: file.buffer.length },
    });
    return { documentId: doc.id, key, bytes: file.buffer.length };
  }

  /**
   * 下载原件：仅所属供应商与内部角色。
   * 买家永远走脱敏副本通道（不在此开放），身份防火墙不因便利让步。
   */
  async downloadDocumentFile(documentId: string, user: JwtPayload) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
    if (!doc) throw new NotFoundException({ code: "NOT_FOUND", detail: "单证不存在" });
    if (doc.ownerOrgId !== user.orgId && !this.isStaff(user)) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织单证" });
    }
    if (!doc.fileKey || doc.fileKey.startsWith("pending-upload/")) {
      throw new NotFoundException({ code: "NOT_FOUND", detail: "原件尚未上传" });
    }
    const obj = await this.storage.get(doc.fileKey);
    if (!obj) throw new NotFoundException({ code: "NOT_FOUND", detail: "原件不存在于存储" });
    await this.audit.log({
      actorId: user.sub, actorRole: user.roles.join(","), action: "DOC_FILE_DOWNLOADED",
      targetType: "Document", targetId: doc.id,
    });
    return { ...obj, filename: `${doc.docType}-${doc.docNo ?? doc.id.slice(0, 8)}.${doc.fileKey.split(".").pop()}` };
  }

  /** 接收方档案：我组织收到的脱敏副本（永不含原件 fileKey） */
  async listReceivedCopies(user: JwtPayload) {
    if (!user.orgId) return [];
    const copies = await this.prisma.maskedDocumentCopy.findMany({
      where: { sentToOrgId: user.orgId },
      orderBy: { sentAt: "desc" },
      include: { document: { select: { docType: true, docNo: true, issueDate: true, expiryDate: true } } },
    });
    return copies.map((c) => ({
      trackingCode: c.trackingCode,
      docType: c.document.docType,
      docNo: c.document.docNo,
      issueDate: c.document.issueDate,
      expiryDate: c.document.expiryDate,
      sentAt: c.sentAt,
    }));
  }

  // ---------- 清关（M11，状态联动订单） ----------

  async createDeclaration(
    input: { orderCode: string; direction: "EXPORT" | "IMPORT"; declarationNo?: string; brokerName?: string },
    user: JwtPayload,
  ) {
    const order = await this.findOrder(input.orderCode);
    const item = await this.prisma.orderItem.findFirst({ where: { orderId: order.id, deletedAt: null } });
    let hsCode = "0000000000";
    if (item) {
      const sku = await this.prisma.productSku.findUnique({ where: { id: item.skuId }, include: { product: { select: { hsCode: true } } } });
      if (sku) hsCode = sku.product.hsCode;
    }
    const declaration = await this.prisma.customsDeclaration.upsert({
      where: { orderId_direction: { orderId: order.id, direction: input.direction } },
      create: {
        orderId: order.id,
        direction: input.direction,
        declarationNo: input.declarationNo,
        brokerName: input.brokerName,
        hsCode,
        declaredValue: order.grandTotal,
        currency: order.currency,
        status: "DRAFT",
        createdBy: user.sub,
      },
      update: { declarationNo: input.declarationNo, brokerName: input.brokerName, updatedBy: user.sub, version: { increment: 1 } },
    });
    return { declarationId: declaration.id, status: declaration.status, hsCode, declaredValue: declaration.declaredValue };
  }

  async transitionDeclaration(id: string, toState: string, user: JwtPayload, inspectionResult?: string) {
    const declaration = await this.prisma.customsDeclaration.findFirst({ where: { id, deletedAt: null } });
    if (!declaration) throw new NotFoundException({ code: "NOT_FOUND", detail: "报关单不存在" });
    const { emitsEvent } = await this.stateMachine.assertAllowed("CUSTOMS", declaration.status, toState, user.roles);

    await this.prisma.$transaction(async (tx) => {
      await tx.customsDeclaration.update({
        where: { id },
        data: {
          status: toState,
          declaredAt: toState === "SUBMITTED" ? new Date() : undefined,
          clearedAt: toState === "CLEARED" ? new Date() : undefined,
          inspectionResult,
          updatedBy: user.sub,
          version: { increment: 1 },
        },
      });
      await this.stateMachine.recordInTx(
        tx, "CUSTOMS", declaration.status, toState,
        { actorId: user.sub, actorRoles: user.roles, targetType: "CustomsDeclaration", targetId: id },
        emitsEvent, { declarationId: id, orderId: declaration.orderId, direction: declaration.direction, to: toState },
      );
      // 出口报关联动订单状态（M11：SUBMITTED→订单 IN_CUSTOMS；CLEARED→订单 CUSTOMS_CLEARED）
      if (declaration.direction === "EXPORT") {
        const order = await tx.tradeOrder.findUniqueOrThrow({ where: { id: declaration.orderId } });
        const target = toState === "SUBMITTED" ? "IN_CUSTOMS" : toState === "CLEARED" ? "CUSTOMS_CLEARED" : null;
        if (target && order.status !== target) {
          const t = await this.stateMachine.assertAllowed("ORDER", order.status, target, user.roles);
          await tx.tradeOrder.update({ where: { id: order.id }, data: { status: target, version: { increment: 1 } } });
          await this.stateMachine.recordInTx(
            tx, "ORDER", order.status, target,
            { actorId: user.sub, actorRoles: user.roles, targetType: "TradeOrder", targetId: order.id, reason: `customs ${toState}` },
            t.emitsEvent, { orderId: order.id, code: order.publicCode, to: target },
          );
        }
      }
    });
    return { declarationId: id, status: toState };
  }

  // ---------- CITES 配额（M11 FR-11-03） ----------

  async createCitesPermit(
    input: { supplierOrgCode: string; permitNo: string; speciesCode: string; quotaKg: number; issueDate: string; expiryDate: string },
    user: JwtPayload,
  ) {
    const supplier = await this.prisma.organization.findFirst({ where: { publicCode: input.supplierOrgCode, deletedAt: null } });
    if (!supplier) throw new NotFoundException({ code: "NOT_FOUND", detail: "供应商不存在" });
    const permit = await this.prisma.citesPermit.create({
      data: {
        supplierOrgId: supplier.id,
        permitNo: input.permitNo,
        speciesCode: input.speciesCode,
        quotaKg: new Prisma.Decimal(input.quotaKg),
        issueDate: new Date(input.issueDate),
        expiryDate: new Date(input.expiryDate),
        createdBy: user.sub,
      },
    });
    return { permitNo: permit.permitNo, quotaKg: permit.quotaKg };
  }

  async deductCites(permitNo: string, kg: number, user: JwtPayload) {
    const permit = await this.prisma.citesPermit.findUnique({ where: { permitNo } });
    if (!permit) throw new NotFoundException({ code: "NOT_FOUND", detail: "许可证不存在" });
    if (permit.expiryDate < new Date()) throw new ConflictException({ code: "CITES_QUOTA_EXCEEDED", detail: "许可证已过期" });
    const remaining = permit.quotaKg.minus(permit.usedKg);
    if (remaining.lt(kg)) {
      throw new ConflictException({ code: "CITES_QUOTA_EXCEEDED", detail: `CITES 配额不足：剩余 ${remaining} kg` });
    }
    const updated = await this.prisma.citesPermit.update({
      where: { permitNo },
      data: { usedKg: { increment: new Prisma.Decimal(kg) }, updatedBy: user.sub, version: { increment: 1 } },
    });
    await this.audit.log({ actorId: user.sub, action: "CITES_DEDUCT", targetType: "CitesPermit", targetId: permit.id, diff: { kg, usedKg: updated.usedKg.toString() } });
    return { permitNo, usedKg: updated.usedKg, remainingKg: updated.quotaKg.minus(updated.usedKg) };
  }

  async listCitesPermits(expiringDays: number | undefined, user: JwtPayload) {
    const where: Prisma.CitesPermitWhereInput = { deletedAt: null };
    if (!this.isStaff(user)) where.supplierOrgId = user.orgId ?? "";
    if (expiringDays) where.expiryDate = { lte: new Date(Date.now() + expiringDays * 86_400_000) };
    const permits = await this.prisma.citesPermit.findMany({ where, orderBy: { expiryDate: "asc" } });
    return permits.map((p) => ({
      permitNo: p.permitNo,
      speciesCode: p.speciesCode,
      quotaKg: p.quotaKg,
      usedKg: p.usedKg,
      remainingKg: p.quotaKg.minus(p.usedKg),
      expiryDate: p.expiryDate,
      status: p.status,
    }));
  }

  // ---------- helpers ----------

  private async findOrder(orderCode: string) {
    const order = await this.prisma.tradeOrder.findFirst({ where: { publicCode: orderCode, deletedAt: null } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", detail: "订单不存在" });
    return order;
  }

  private isStaff(user: JwtPayload): boolean {
    return user.roles.some((r) => ["ADMIN", "SUPER_ADMIN", "LOGISTICS_OPERATOR", "CUSTOMS_OFFICER", "BROKER", "CUSTOMER_SERVICE"].includes(r));
  }
}
