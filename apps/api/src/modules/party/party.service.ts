import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CryptoService } from "../../kernel/crypto/crypto.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { OutboxService } from "../../kernel/outbox/outbox.service";
import type { JwtPayload } from "../iam/auth.types";

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

  async listPending(page: number, pageSize: number) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where: { status: "PENDING", deletedAt: null },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.organization.count({ where: { status: "PENDING", deletedAt: null } }),
    ]);
    return {
      data: rows.map((o) => ({
        publicCode: o.publicCode,
        partyType: o.partyType,
        countryIso2: o.countryIso2,
        // 审核场景管理员可见公司名（低敏即时放行，仍留审计由 controller 调用 viewSensitive）
        submittedAt: o.createdAt,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
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
