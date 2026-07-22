import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CryptoService } from "../../kernel/crypto/crypto.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { CommunicationService } from "../communication/communication.service";
import { StoragePort } from "../files/storage.port";
import type { JwtPayload } from "../iam/auth.types";

export type DsrType = "EXPORT" | "DELETE";

/** 导出包下载有效期（GDPR 要求可取，但不宜长期留存副本） */
const DOWNLOAD_TTL_HOURS = 72;
/** 删除后仍在途的订单状态：这些状态下不得注销账号（合同履行义务优先于 Art.17） */
const IN_FLIGHT_ORDER_STATES = [
  "PLACED", "PAID_ESCROW", "CONFIRMED", "PREPARING", "SHIPPED",
  "IN_CUSTOMS", "CUSTOMS_CLEARED", "DELIVERED", "DISPUTED", "RESOLVED",
];

/**
 * GDPR 数据主体请求（R1-7）。
 *
 * Art.15 访问权 → EXPORT：把该自然人相关数据打包成 JSON 落私有存储，凭一次性令牌限时下载。
 * Art.17 被遗忘权 → DELETE：**匿名化而非物理删除**。交易、发票、账本、审计属 Art.17(3)(b)(e)
 * 法定留存范围，删掉会破坏资金对账与合规举证；因此只抹掉可识别自然人的字段，业务记录保持完整。
 *
 * 两类请求都必须人工审批（内部合规角色），杜绝账号被劫持后一键抹除证据。
 */
@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly comm: CommunicationService,
    private readonly storage: StoragePort,
  ) {}

  // ---------- 请求受理 ----------

  /** 本人发起请求；同类型同时只允许一条待办，避免刷单 */
  async submit(requestType: DsrType, reason: string | undefined, user: JwtPayload) {
    const pending = await this.prisma.dataSubjectRequest.findFirst({
      where: { userId: user.sub, requestType, status: "PENDING" },
    });
    if (pending) {
      throw new ConflictException({ code: "VALIDATION_FAILED", detail: "已有同类型请求待处理", requestId: pending.id });
    }
    const request = await this.prisma.dataSubjectRequest.create({
      data: { userId: user.sub, requestType, reason },
    });
    await this.audit.log({
      actorId: user.sub, action: "GDPR_REQUEST_SUBMITTED", targetType: "DataSubjectRequest",
      targetId: request.id, diff: { requestType },
    });
    const staff = await this.internalStaffIds();
    for (const userId of staff) {
      await this.comm.notifyUser(userId, "GDPR_REQUEST_SUBMITTED", { requestId: request.id, requestType });
    }
    return { requestId: request.id, status: request.status, requestType };
  }

  async listMine(user: JwtPayload) {
    const rows = await this.prisma.dataSubjectRequest.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
      select: { id: true, requestType: true, status: true, reason: true, createdAt: true, handledAt: true, expiresAt: true },
    });
    return rows;
  }

  /** 内部待办队列 */
  async listPending() {
    return this.prisma.dataSubjectRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true, requestType: true, reason: true, createdAt: true },
    });
  }

  async reject(requestId: string, reason: string, staff: JwtPayload) {
    const request = await this.loadPending(requestId);
    await this.prisma.dataSubjectRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", reason, handledBy: staff.sub, handledAt: new Date(), version: { increment: 1 } },
    });
    await this.audit.log({
      actorId: staff.sub, actorRole: staff.roles.join(","), action: "GDPR_REQUEST_REJECTED",
      targetType: "DataSubjectRequest", targetId: request.id, reason,
    });
    await this.comm.notifyUser(request.userId, "GDPR_REQUEST_REJECTED", { requestId: request.id, requestType: request.requestType });
    return { requestId: request.id, status: "REJECTED" };
  }

  /** 批准并立即执行；EXPORT 返回一次性下载令牌（此后不可再取） */
  async approve(requestId: string, staff: JwtPayload) {
    const request = await this.loadPending(requestId);
    if (request.requestType === "EXPORT") return this.executeExport(request.id, request.userId, staff);
    if (request.requestType === "DELETE") return this.executeErasure(request.id, request.userId, staff);
    throw new ConflictException({ code: "VALIDATION_FAILED", detail: `未知请求类型 ${request.requestType}` });
  }

  private async loadPending(requestId: string) {
    const request = await this.prisma.dataSubjectRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException({ code: "NOT_FOUND", detail: "请求不存在" });
    if (request.status !== "PENDING") {
      throw new ConflictException({ code: "STATE_TRANSITION_INVALID", detail: `请求已处理（${request.status}）` });
    }
    return request;
  }

  private async internalStaffIds(): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { deletedAt: null, role: { code: { in: ["ADMIN", "SUPER_ADMIN"] } } },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  // ---------- Art.15 导出 ----------

  private async executeExport(requestId: string, subjectId: string, staff: JwtPayload) {
    const bundle = await this.buildExportBundle(subjectId);
    const body = Buffer.from(JSON.stringify(bundle, null, 2), "utf8");
    const key = `gdpr-exports/${subjectId}/${requestId}.json`;
    await this.storage.put(key, body, "application/json");

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_HOURS * 3_600_000);
    await this.prisma.dataSubjectRequest.update({
      where: { id: requestId },
      data: {
        status: "COMPLETED", handledBy: staff.sub, handledAt: new Date(),
        resultFileKey: key, tokenHash: this.crypto.sha256(token), expiresAt, version: { increment: 1 },
      },
    });
    await this.audit.log({
      actorId: staff.sub, actorRole: staff.roles.join(","), action: "GDPR_EXPORT_GENERATED",
      targetType: "DataSubjectRequest", targetId: requestId, diff: { key, bytes: body.length },
    });
    await this.comm.notifyUser(subjectId, "GDPR_EXPORT_READY", { requestId, expiresAt: expiresAt.toISOString() });
    return { requestId, status: "COMPLETED", downloadToken: token, expiresAt, bytes: body.length };
  }

  /**
   * 导出内容以「该自然人可识别的数据」为界：本人档案、所属组织与角色、本人产生的行为与消息。
   * 不含对手方信息（身份防火墙不因数据权请求让步），也不含其他成员的记录。
   */
  private async buildExportBundle(subjectId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: subjectId },
      include: { roles: { where: { deletedAt: null }, include: { role: true } } },
    });
    if (!user) throw new NotFoundException({ code: "NOT_FOUND", detail: "用户不存在" });

    const memberships = await this.prisma.membership.findMany({ where: { userId: subjectId, deletedAt: null } });
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: memberships.map((m) => m.orgId) } },
      select: { id: true, publicCode: true, legalNameEnc: true, partyType: true, status: true, countryIso2: true },
    });
    const orgById = new Map(
      orgs.map((o) => [
        o.id,
        { publicCode: o.publicCode, legalName: this.crypto.decrypt(o.legalNameEnc), partyType: o.partyType, status: o.status, countryIso2: o.countryIso2 },
      ]),
    );

    const [sessions, notifications, messages, auditLogs, behaviorEvents, orders] = await Promise.all([
      this.prisma.session.findMany({
        where: { userId: subjectId },
        select: { ip: true, createdAt: true, expiresAt: true, revokedAt: true },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.notification.findMany({
        where: { userId: subjectId },
        select: { templateCode: true, payload: true, status: true, createdAt: true, readAt: true },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.message.findMany({
        where: { senderUserId: subjectId, deletedAt: null },
        select: { conversationId: true, body: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.auditLog.findMany({
        where: { actorId: subjectId },
        select: { action: true, targetType: true, targetId: true, ip: true, occurredAt: true },
        orderBy: { occurredAt: "desc" },
        take: 5000,
      }),
      this.prisma.behaviorEvent.findMany({
        where: { userId: subjectId },
        select: { eventType: true, payload: true, occurredAt: true },
        orderBy: { occurredAt: "desc" },
        take: 5000,
      }),
      this.prisma.tradeOrder.findMany({
        where: { createdBy: subjectId, deletedAt: null },
        select: { publicCode: true, status: true, currency: true, grandTotal: true, placedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      meta: {
        generatedAt: new Date().toISOString(),
        legalBasis: "GDPR Art.15 — right of access by the data subject",
        subjectId,
        note: "本导出仅含与您本人相关的数据；交易对手方信息受平台身份保护规则限制不予提供。",
      },
      profile: {
        id: user.id,
        displayName: user.displayName,
        email: this.crypto.decrypt(user.emailEnc),
        phone: user.phoneEnc ? this.crypto.decrypt(user.phoneEnc) : null,
        locale: user.locale,
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        twoFactorEnabled: user.totpSecretEnc !== null,
        roles: user.roles.map((r) => r.role.code),
      },
      organizations: memberships.map((m) => ({ orgRole: m.orgRole, joinedAt: m.createdAt, ...orgById.get(m.orgId) })),
      sessions,
      notifications,
      messages,
      orders: orders.map((o) => ({ ...o, grandTotal: o.grandTotal.toString() })),
      auditLogs,
      behaviorEvents: behaviorEvents.map((e) => ({ ...e, occurredAt: e.occurredAt })),
    };
  }

  /** 本人凭令牌取包：令牌哈希比对 + 有效期，双双通过才回源对象存储 */
  async downloadExport(token: string, user: JwtPayload) {
    const request = await this.prisma.dataSubjectRequest.findUnique({ where: { tokenHash: this.crypto.sha256(token) } });
    if (!request || !request.resultFileKey) throw new NotFoundException({ code: "NOT_FOUND", detail: "下载链接无效" });
    if (request.userId !== user.sub) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "导出包仅本人可取" });
    }
    if (!request.expiresAt || request.expiresAt < new Date()) {
      throw new NotFoundException({ code: "AUTH_TOKEN_EXPIRED", detail: "下载链接已过期，请重新申请" });
    }
    const obj = await this.storage.get(request.resultFileKey);
    if (!obj) throw new NotFoundException({ code: "NOT_FOUND", detail: "导出包不存在于存储" });
    await this.audit.log({
      actorId: user.sub, action: "GDPR_EXPORT_DOWNLOADED", targetType: "DataSubjectRequest", targetId: request.id,
    });
    return { ...obj, filename: `oussouri-data-export-${request.id.slice(0, 8)}.json` };
  }

  // ---------- Art.17 匿名化 ----------

  private async executeErasure(requestId: string, subjectId: string, staff: JwtPayload) {
    await this.assertErasable(subjectId);

    const placeholderEmail = `erased+${subjectId}@invalid.oussouri`;
    const report: Record<string, number | string> = {};

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: subjectId },
        data: {
          emailEnc: this.crypto.encrypt(placeholderEmail),
          emailBidx: this.crypto.blindIndex(placeholderEmail),
          phoneEnc: null,
          phoneBidx: null,
          passwordHash: null,
          totpSecretEnc: null,
          displayName: "Erased user",
          status: "DISABLED",
          deletedAt: new Date(),
          updatedBy: staff.sub,
          version: { increment: 1 },
        },
      });
      // 会话与登录凭据：立即失效，账号不可再登录
      report.sessionsRevoked = (await tx.session.updateMany({ where: { userId: subjectId, revokedAt: null }, data: { revokedAt: new Date() } })).count;
      report.oauthAccountsDeleted = (await tx.oAuthAccount.deleteMany({ where: { userId: subjectId } })).count;
      report.resetTokensDeleted = (await tx.passwordResetToken.deleteMany({ where: { userId: subjectId } })).count;
      // 通知与行为画像：无留存义务，直接清
      report.notificationsDeleted = (await tx.notification.deleteMany({ where: { userId: subjectId } })).count;
      report.behaviorEventsAnonymised = (await tx.behaviorEvent.updateMany({ where: { userId: subjectId }, data: { userId: null } })).count;
      // 消息正文可能含自述个人信息；会话结构保留供对手方举证
      report.messagesRedacted = (await tx.message.updateMany({
        where: { senderUserId: subjectId, deletedAt: null },
        data: { body: "[erased on data subject request]", translatedBody: undefined },
      })).count;
      // 组织成员关系解除（组织本身是法人主体，不在自然人删除范围）
      report.membershipsRemoved = (await tx.membership.updateMany({ where: { userId: subjectId, deletedAt: null }, data: { deletedAt: new Date() } })).count;
      report.rolesRemoved = (await tx.userRole.updateMany({ where: { userId: subjectId, deletedAt: null }, data: { deletedAt: new Date() } })).count;
      report.retained = "订单/发票/账本/审计日志按 GDPR Art.17(3)(b)(e) 与商法留存义务保留，仅保留不可回指自然人的 UUID";

      await tx.dataSubjectRequest.update({
        where: { id: requestId },
        data: {
          status: "COMPLETED", handledBy: staff.sub, handledAt: new Date(),
          erasureReport: report, version: { increment: 1 },
        },
      });
    });

    await this.audit.log({
      actorId: staff.sub, actorRole: staff.roles.join(","), action: "GDPR_ERASURE_EXECUTED",
      targetType: "User", targetId: subjectId, diff: report,
    });
    this.logger.log(`GDPR 匿名化完成：user=${subjectId} request=${requestId}`);
    return { requestId, status: "COMPLETED", erasureReport: report };
  }

  /** 在途交易与未结资金优先：此时注销会让对手方无人对接，属 Art.17(3)(b) 合同履行例外 */
  private async assertErasable(subjectId: string): Promise<void> {
    const memberships = await this.prisma.membership.findMany({ where: { userId: subjectId, deletedAt: null } });
    for (const m of memberships) {
      const others = await this.prisma.membership.count({ where: { orgId: m.orgId, deletedAt: null, userId: { not: subjectId } } });
      if (others > 0) continue; // 组织还有别人接手
      const inFlight = await this.prisma.tradeOrder.count({
        where: {
          deletedAt: null,
          status: { in: IN_FLIGHT_ORDER_STATES },
          OR: [{ buyerOrgId: m.orgId }, { supplierOrgId: m.orgId }],
        },
      });
      if (inFlight > 0) {
        throw new ConflictException({
          code: "STATE_TRANSITION_INVALID",
          detail: `所属组织尚有 ${inFlight} 笔在途订单且无其他成员，须先了结或移交后才能注销（GDPR Art.17(3)(b)）`,
        });
      }
    }
  }
}
