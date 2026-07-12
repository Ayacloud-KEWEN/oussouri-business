import { Controller, Get, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Roles } from "../../modules/iam/roles.guard";
import type { Prisma } from "@prisma/client";

/** 审计日志检索（R2 管理后台补齐）；日志本身只读 */
@Roles("SUPER_ADMIN")
@Controller("admin/audit")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async search(
    @Query("action") action?: string,
    @Query("targetType") targetType?: string,
    @Query("targetId") targetId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "50",
  ) {
    const where: Prisma.AuditLogWhereInput = {
      ...(action ? { action: { contains: action.toUpperCase() } } : {}),
      ...(targetType ? { targetType } : {}),
      ...(targetId ? { targetId } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    };
    const p = Math.max(Number(page) || 1, 1);
    const size = Math.min(Number(pageSize) || 50, 200);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { occurredAt: "desc" }, skip: (p - 1) * size, take: size }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => Boolean(id)))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } });
    const nameMap = new Map(actors.map((a) => [a.id, a.displayName]));
    return {
      data: rows.map((r) => ({
        id: r.id,
        actor: r.actorId ? (nameMap.get(r.actorId) ?? r.actorId.slice(0, 8)) : "system",
        actorRole: r.actorRole,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        diff: r.diff,
        reason: r.reason,
        ip: r.ip,
        occurredAt: r.occurredAt,
      })),
      meta: { page: p, pageSize: size, total, totalPages: Math.ceil(total / size) },
    };
  }
}
