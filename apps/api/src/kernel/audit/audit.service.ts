import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  diff?: Prisma.InputJsonValue;
  reason?: string;
  ip?: string;
  userAgent?: string;
}

/** 审计写入（GBR-5）。审计失败绝不吞掉业务事务外的错误静默——记录并告警。 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 与业务同事务写入（关键路径用） */
  async logInTx(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.toData(entry) });
  }

  /** 独立写入（读敏感信息、登录等） */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.toData(entry) });
    } catch (err) {
      this.logger.error(`审计写入失败: ${entry.action}`, err instanceof Error ? err.stack : String(err));
      throw err;
    }
  }

  private toData(entry: AuditEntry): Prisma.AuditLogCreateInput {
    return {
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      diff: entry.diff,
      reason: entry.reason,
      ip: entry.ip,
      userAgent: entry.userAgent,
    };
  }
}
