import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CryptoService } from "../../kernel/crypto/crypto.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { OutboxService } from "../../kernel/outbox/outbox.service";
import type { JwtPayload } from "../iam/auth.types";
import type { PartyStatus, PartyType } from "@prisma/client";

/** 高敏字段清单：读取必须走穿透审批（M19 FR-19-02） */
const HIGH_SENSITIVITY_FIELDS = new Set(["taxId", "registrationNo", "legalRep", "address"]);

@Injectable()
export class PartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async myProfile(user: JwtPayload) {
    if (!user.orgId) throw new NotFoundException({ code: "NOT_FOUND", detail: "无组织" });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
    // 本组织成员可见自己的真实信息
    return {
      publicCode: org.publicCode,
      partyType: org.partyType,
      status: org.status,
      companyName: this.crypto.decrypt(org.legalNameEnc),
      countryIso2: org.countryIso2,
    };
  }

  /**
   * 管理端主体列表：默认入驻审核队列（PENDING），status=ALL 时为全量名录。
   * 管理员按可见性矩阵可见真实公司名与证书（初稿 §11.2），
   * 每次查看整批留一条审计（含涉及的代码清单）。
   */
  async listParties(
    filters: { status?: string; partyType?: string; page: number; pageSize: number },
    actor: JwtPayload,
  ) {
    const status = filters.status ?? "PENDING";
    const where = {
      deletedAt: null,
      ...(status === "ALL" ? {} : { status: status as PartyStatus }),
      ...(filters.partyType ? { partyType: filters.partyType as PartyType } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: { certificates: { where: { deletedAt: null } }, contacts: { where: { deletedAt: null }, take: 1, orderBy: { isPrimary: "desc" } } },
      }),
      this.prisma.organization.count({ where }),
    ]);
    if (rows.length > 0) {
      await this.audit.log({
        actorId: actor.sub,
        actorRole: actor.roles.join(","),
        action: "VIEW_SENSITIVE",
        targetType: "Organization",
        diff: {
          scene: status === "PENDING" ? "ONBOARDING_REVIEW_QUEUE" : "PARTY_DIRECTORY",
          codes: rows.map((o) => o.publicCode),
        },
        reason: status === "PENDING" ? "入驻审核" : "主体名录查看",
      });
    }
    return {
      data: rows.map((o) => ({
        publicCode: o.publicCode,
        partyType: o.partyType,
        status: o.status,
        countryIso2: o.countryIso2,
        companyName: this.crypto.decrypt(o.legalNameEnc),
        registrationNo: o.registrationNoEnc ? this.crypto.decrypt(o.registrationNoEnc) : null,
        taxId: o.taxIdEnc ? this.crypto.decrypt(o.taxIdEnc) : null,
        contactName: o.contacts[0]?.nameEnc ? this.crypto.decrypt(o.contacts[0].nameEnc) : null,
        certificates: o.certificates.map((c) => ({ certType: c.certType, certNo: c.certNo, expiryDate: c.expiryDate, status: c.status })),
        submittedAt: o.createdAt,
        approvedAt: o.approvedAt,
      })),
      meta: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) },
    };
  }

  async approve(publicCode: string, decision: "APPROVE" | "REJECT", actor: JwtPayload, notes?: string) {
    const org = await this.prisma.organization.findFirst({ where: { publicCode, deletedAt: null } });
    if (!org) throw new NotFoundException({ code: "NOT_FOUND", detail: "组织不存在" });
    const status = decision === "APPROVE" ? "ACTIVE" : "INACTIVE";
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: org.id },
        data: { status, approvedBy: actor.sub, approvedAt: new Date(), riskNotes: notes, version: { increment: 1 } },
      });
      await this.audit.logInTx(tx, {
        actorId: actor.sub,
        actorRole: actor.roles.join(","),
        action: "PARTY_REVIEW",
        targetType: "Organization",
        targetId: org.id,
        diff: { from: org.status, to: status },
        reason: notes,
      });
      await this.outbox.emitInTx(tx, `Organization:${org.id}`, decision === "APPROVE" ? "PartyApproved" : "PartyRejected", {
        orgId: org.id,
        publicCode: org.publicCode,
      });
    });
    return { publicCode, status };
  }

  /** 本组织联系人（全加密存储；用于平台代理外呼，Broker 不可见明文） */
  async addContact(
    input: { name: string; phone?: string; email?: string; position?: string; isPrimary?: boolean },
    user: JwtPayload,
  ) {
    if (!user.orgId) throw new NotFoundException({ code: "NOT_FOUND", detail: "无组织" });
    if (input.isPrimary) {
      await this.prisma.contact.updateMany({ where: { orgId: user.orgId, deletedAt: null }, data: { isPrimary: false } });
    }
    const contact = await this.prisma.contact.create({
      data: {
        orgId: user.orgId,
        nameEnc: this.crypto.encrypt(input.name),
        phoneEnc: input.phone ? this.crypto.encrypt(input.phone) : null,
        emailEnc: input.email ? this.crypto.encrypt(input.email) : null,
        positionEnc: input.position ? this.crypto.encrypt(input.position) : null,
        isPrimary: input.isPrimary ?? false,
        createdBy: user.sub,
      },
    });
    return { contactId: contact.id, isPrimary: contact.isPrimary };
  }

  // ---------- 自助档案维护（R1.6-2）：本组织可见可改，对手方永不可见 ----------

  /** 本组织联系人列表（解密返回：这是自己的数据） */
  async listContacts(user: JwtPayload) {
    if (!user.orgId) throw new NotFoundException({ code: "NOT_FOUND", detail: "无组织" });
    const rows = await this.prisma.contact.findMany({
      where: { orgId: user.orgId, deletedAt: null },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return rows.map((c) => ({
      id: c.id,
      name: this.crypto.decrypt(c.nameEnc),
      phone: c.phoneEnc ? this.crypto.decrypt(c.phoneEnc) : null,
      email: c.emailEnc ? this.crypto.decrypt(c.emailEnc) : null,
      position: c.positionEnc ? this.crypto.decrypt(c.positionEnc) : null,
      isPrimary: c.isPrimary,
    }));
  }

  async removeContact(id: string, user: JwtPayload) {
    if (!user.orgId) throw new NotFoundException({ code: "NOT_FOUND", detail: "无组织" });
    const contact = await this.prisma.contact.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
    if (!contact) throw new NotFoundException({ code: "NOT_FOUND", detail: "联系人不存在" });
    await this.prisma.contact.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.sub } });
    return { removed: id };
  }

  /** 本组织资质证书列表 */
  async listCertificates(user: JwtPayload) {
    if (!user.orgId) throw new NotFoundException({ code: "NOT_FOUND", detail: "无组织" });
    const rows = await this.prisma.partyCertificate.findMany({
      where: { orgId: user.orgId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, certType: true, certNo: true, issuer: true, issueDate: true, expiryDate: true, status: true },
    });
    return rows;
  }

  async addCertificate(
    input: { certType: string; certNo: string; issuer?: string; issueDate?: string; expiryDate?: string },
    user: JwtPayload,
  ) {
    if (!user.orgId) throw new NotFoundException({ code: "NOT_FOUND", detail: "无组织" });
    const cert = await this.prisma.partyCertificate.create({
      data: {
        orgId: user.orgId,
        certType: input.certType,
        certNo: input.certNo,
        issuer: input.issuer,
        issueDate: input.issueDate ? new Date(input.issueDate) : undefined,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
        // 自助登记默认待平台核验，避免自证有效
        status: "PENDING",
        createdBy: user.sub,
      },
    });
    await this.audit.log({
      actorId: user.sub, actorRole: user.roles.join(","), action: "CERT_SELF_REGISTERED",
      targetType: "PartyCertificate", targetId: cert.id, diff: { certType: cert.certType, certNo: cert.certNo },
    });
    return { certificateId: cert.id, status: cert.status };
  }

  async removeCertificate(id: string, user: JwtPayload) {
    if (!user.orgId) throw new NotFoundException({ code: "NOT_FOUND", detail: "无组织" });
    const cert = await this.prisma.partyCertificate.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
    if (!cert) throw new NotFoundException({ code: "NOT_FOUND", detail: "证书不存在" });
    await this.prisma.partyCertificate.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.sub } });
    return { removed: id };
  }

  /** 穿透申请：低敏即时放行（事后抄送），高敏待超管审批 */
  async requestEscalation(publicCode: string, fields: string[], reason: string, actor: JwtPayload) {
    const org = await this.prisma.organization.findFirst({ where: { publicCode, deletedAt: null } });
    if (!org) throw new NotFoundException({ code: "NOT_FOUND", detail: "组织不存在" });
    const isHigh = fields.some((f) => HIGH_SENSITIVITY_FIELDS.has(f));
    const escalation = await this.prisma.$transaction(async (tx) => {
      const esc = await tx.accessEscalation.create({
        data: {
          requesterId: actor.sub,
          targetType: "Organization",
          targetId: org.id,
          fields,
          reason,
          sensitivity: isHigh ? "HIGH" : "LOW",
          status: isHigh ? "PENDING" : "APPROVED",
          windowUntil: isHigh ? null : new Date(Date.now() + 30 * 60_000),
        },
      });
      await this.audit.logInTx(tx, {
        actorId: actor.sub,
        actorRole: actor.roles.join(","),
        action: "ESCALATION_REQUEST",
        targetType: "Organization",
        targetId: org.id,
        diff: { fields, sensitivity: esc.sensitivity },
        reason,
      });
      // 抄送超管（通知消费者处理）
      await this.outbox.emitInTx(tx, `AccessEscalation:${esc.id}`, "AccessEscalated", {
        escalationId: esc.id,
        requesterId: actor.sub,
        targetCode: publicCode,
        fields,
        sensitivity: esc.sensitivity,
      });
      return esc;
    });
    return { escalationId: escalation.id, status: escalation.status, windowUntil: escalation.windowUntil };
  }

  async decideEscalation(id: string, decision: "APPROVE" | "DENY", actor: JwtPayload) {
    const esc = await this.prisma.accessEscalation.findUniqueOrThrow({ where: { id } });
    const status = decision === "APPROVE" ? "APPROVED" : "DENIED";
    const updated = await this.prisma.accessEscalation.update({
      where: { id },
      data: {
        status,
        approvedBy: actor.sub,
        windowUntil: decision === "APPROVE" ? new Date(Date.now() + 30 * 60_000) : null,
        version: { increment: 1 },
      },
    });
    await this.audit.log({
      actorId: actor.sub,
      actorRole: actor.roles.join(","),
      action: "ESCALATION_DECIDE",
      targetType: "AccessEscalation",
      targetId: esc.id,
      diff: { decision },
    });
    return { escalationId: updated.id, status: updated.status, windowUntil: updated.windowUntil };
  }

  /** 凭已批准且在时限窗口内的穿透申请读取解密字段（每次读取均审计） */
  async viewSensitive(publicCode: string, escalationId: string, actor: JwtPayload) {
    const org = await this.prisma.organization.findFirst({ where: { publicCode, deletedAt: null } });
    if (!org) throw new NotFoundException({ code: "NOT_FOUND", detail: "组织不存在" });
    const esc = await this.prisma.accessEscalation.findUnique({ where: { id: escalationId } });
    if (
      !esc ||
      esc.requesterId !== actor.sub ||
      esc.targetId !== org.id ||
      esc.status !== "APPROVED" ||
      !esc.windowUntil ||
      esc.windowUntil < new Date()
    ) {
      throw new ForbiddenException({ code: "PERM_ESCALATION_REQUIRED", detail: "无有效穿透授权（需审批或已过窗口）" });
    }
    const result: Record<string, string | null> = {};
    for (const field of esc.fields) {
      switch (field) {
        case "companyName": result.companyName = this.crypto.decrypt(org.legalNameEnc); break;
        case "registrationNo": result.registrationNo = org.registrationNoEnc ? this.crypto.decrypt(org.registrationNoEnc) : null; break;
        case "taxId": result.taxId = org.taxIdEnc ? this.crypto.decrypt(org.taxIdEnc) : null; break;
        case "legalRep": result.legalRep = org.legalRepEnc ? this.crypto.decrypt(org.legalRepEnc) : null; break;
        case "address": result.address = org.addressEnc ? this.crypto.decrypt(org.addressEnc) : null; break;
        default: break;
      }
    }
    await this.audit.log({
      actorId: actor.sub,
      actorRole: actor.roles.join(","),
      action: "VIEW_SENSITIVE",
      targetType: "Organization",
      targetId: org.id,
      diff: { fields: esc.fields, escalationId },
      reason: esc.reason,
    });
    return result;
  }
}
