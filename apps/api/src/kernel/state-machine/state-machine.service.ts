import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../outbox/outbox.service";

export interface TransitionContext {
  actorId?: string;
  actorRoles: string[];
  targetType: string;
  targetId: string;
  reason?: string;
}

/**
 * 状态机执行器（GBR-6）：迁移表数据化（种子写入 state_transitions），
 * 统一做 角色校验 → 迁移合法性 → 审计 → 领域事件。
 * 实体状态列的更新由调用方在同一事务内完成（本服务返回校验通过的迁移）。
 */
@Injectable()
export class StateMachineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async assertAllowed(machineCode: string, fromState: string, toState: string, roles: string[]): Promise<{ emitsEvent: string | null }> {
    const transition = await this.prisma.stateTransition.findFirst({
      where: { machineCode, fromState, toState, deletedAt: null },
    });
    if (!transition) {
      throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: `${machineCode}: ${fromState} → ${toState} 不允许` });
    }
    const roleOk = transition.allowedRoles.includes("*") || roles.some((r) => transition.allowedRoles.includes(r));
    if (!roleOk) {
      throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: `角色无权执行 ${fromState} → ${toState}` });
    }
    return { emitsEvent: transition.emitsEvent };
  }

  /** 校验 + 审计 + 事件（在调用方事务内） */
  async recordInTx(
    tx: Prisma.TransactionClient,
    machineCode: string,
    fromState: string,
    toState: string,
    ctx: TransitionContext,
    emitsEvent: string | null,
    eventPayload: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.audit.logInTx(tx, {
      actorId: ctx.actorId,
      actorRole: ctx.actorRoles.join(","),
      action: "STATE_CHANGE",
      targetType: ctx.targetType,
      targetId: ctx.targetId,
      diff: { machine: machineCode, from: fromState, to: toState },
      reason: ctx.reason,
    });
    if (emitsEvent) {
      await this.outbox.emitInTx(tx, `${ctx.targetType}:${ctx.targetId}`, emitsEvent, eventPayload);
    }
  }
}
