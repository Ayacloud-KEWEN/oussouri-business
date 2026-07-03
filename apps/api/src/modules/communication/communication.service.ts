import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { PiiFilterService } from "../../kernel/pii/pii-filter.service";
import { AuditService } from "../../kernel/audit/audit.service";
import type { JwtPayload } from "../iam/auth.types";

const BLOCK_FREEZE_THRESHOLD = 3;
const BLOCK_WINDOW_DAYS = 30;

@Injectable()
export class CommunicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly piiFilter: PiiFilterService,
    private readonly audit: AuditService,
  ) {}

  // ---------- IM（M17） ----------

  async createConversation(topicType: string, topicId: string | undefined, user: JwtPayload) {
    if (!["PRODUCT", "ORDER", "RFQ", "OPPORTUNITY", "SUPPORT"].includes(topicType)) {
      throw new ForbiddenException({ code: "VALIDATION_FAILED", detail: "会话必须挂靠业务对象" });
    }
    const conversation = await this.prisma.conversation.create({
      data: {
        topicType,
        topicId,
        createdBy: user.sub,
        participants: { create: [{ userId: user.sub, orgId: user.orgId, partRole: user.partyType ?? "SUPPORT" }] },
      },
    });
    return { conversationId: conversation.id };
  }

  async sendMessage(conversationId: string, body: string, user: JwtPayload) {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: user.sub, deletedAt: null },
    });
    const isStaff = user.roles.some((r) => ["BROKER", "CUSTOMER_SERVICE", "ADMIN", "SUPER_ADMIN"].includes(r));
    if (!participant && !isStaff) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "非会话参与者" });
    }

    // 出口拦截（GBR-1）：员工（居间/客服）豁免，交易双方强制
    if (!isStaff) {
      const matches = this.piiFilter.scan(body);
      if (matches.length > 0) {
        const blocked = await this.prisma.messageBlockEvent.create({
          data: { userId: user.sub, conversationId, matchedRule: matches.map((m) => m.rule).join(","), rawExcerpt: matches[0]!.excerpt },
        });
        await this.audit.log({
          actorId: user.sub,
          action: "MESSAGE_BLOCKED",
          targetType: "Conversation",
          targetId: conversationId,
          diff: { rules: matches.map((m) => m.rule) },
        });
        const recentBlocks = await this.prisma.messageBlockEvent.count({
          where: { userId: user.sub, occurredAt: { gte: new Date(Date.now() - BLOCK_WINDOW_DAYS * 86_400_000) } },
        });
        if (recentBlocks >= BLOCK_FREEZE_THRESHOLD) {
          await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: "FROZEN", version: { increment: 1 } } });
        }
        throw new UnprocessableEntityException({
          code: "PII_BLOCKED",
          detail: `平台规则：请勿交换联系方式（第 ${Math.min(recentBlocks, BLOCK_FREEZE_THRESHOLD)}/${BLOCK_FREEZE_THRESHOLD} 次警告）`,
          blockId: blocked.id,
        });
      }
    }

    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.status === "FROZEN") {
      throw new ForbiddenException({ code: "PERM_DENIED", detail: "会话不可用（可能因违规被冻结）" });
    }
    const message = await this.prisma.message.create({
      data: { conversationId, senderUserId: user.sub, body },
    });
    return { messageId: message.id, createdAt: message.createdAt };
  }

  async listMessages(conversationId: string, user: JwtPayload) {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: user.sub, deletedAt: null },
    });
    const isStaff = user.roles.some((r) => ["BROKER", "CUSTOMER_SERVICE", "ADMIN", "SUPER_ADMIN"].includes(r));
    if (!participant && !isStaff) throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "非会话参与者" });
    if (isStaff && !participant) {
      await this.audit.log({ actorId: user.sub, actorRole: user.roles.join(","), action: "VIEW_CONVERSATION", targetType: "Conversation", targetId: conversationId });
    }
    return this.prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, senderUserId: true, body: true, createdAt: true },
    });
  }

  // ---------- 通知（M16） ----------

  async notifyUser(userId: string, templateCode: string, payload: Record<string, unknown>): Promise<void> {
    await this.prisma.notification.create({
      data: { userId, templateCode, channel: "INAPP", payload: payload as never },
    });
  }

  async myNotifications(user: JwtPayload) {
    return this.prisma.notification.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, templateCode: true, payload: true, status: true, createdAt: true, readAt: true },
    });
  }

  async markRead(id: string, user: JwtPayload) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== user.sub) throw new NotFoundException({ code: "NOT_FOUND", detail: "通知不存在" });
    await this.prisma.notification.update({ where: { id }, data: { status: "READ", readAt: new Date(), version: { increment: 1 } } });
    return { ok: true };
  }

  // ---------- 领域事件消费者（Outbox → 通知，架构 A3 闭环示例） ----------

  @OnEvent("OrderPaid")
  async onOrderPaid(event: { payload: { orderId: string; code: string } }): Promise<void> {
    const order = await this.prisma.tradeOrder.findUnique({ where: { id: event.payload.orderId } });
    if (!order) return;
    const memberships = await this.prisma.membership.findMany({ where: { orgId: order.supplierOrgId, deletedAt: null } });
    for (const m of memberships) {
      await this.notifyUser(m.userId, "ORDER_PAID", { orderCode: order.publicCode, grandTotal: order.grandTotal.toString(), currency: order.currency });
    }
  }

  @OnEvent("AccessEscalated")
  async onAccessEscalated(event: { payload: { escalationId: string; requesterId: string; targetCode: string; fields: string[]; sensitivity: string } }): Promise<void> {
    // 抄送所有超管（M19 BR：穿透必须实时抄送）
    const superAdmins = await this.prisma.userRole.findMany({
      where: { deletedAt: null, role: { code: "SUPER_ADMIN" } },
      select: { userId: true },
    });
    for (const admin of superAdmins) {
      await this.notifyUser(admin.userId, "ACCESS_ESCALATION", event.payload);
    }
  }
}
