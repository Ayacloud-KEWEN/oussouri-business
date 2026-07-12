import { Controller, Get, Query } from "@nestjs/common";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { Roles } from "../iam/roles.guard";

/** PII 拦截风控看板（R2 管理后台补齐）：GBR-1 出口拦截事件的统计与明细 */
@Roles("ADMIN")
@Controller("admin/risk")
export class RiskController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("blocks")
  async blocks(@Query("days") days = "30", @Query("limit") limit = "50") {
    const since = new Date(Date.now() - Math.min(Number(days) || 30, 365) * 86_400_000);
    const [total, events] = await this.prisma.$transaction([
      this.prisma.messageBlockEvent.count({ where: { occurredAt: { gte: since } } }),
      this.prisma.messageBlockEvent.findMany({
        where: { occurredAt: { gte: since } },
        orderBy: { occurredAt: "desc" },
        take: Math.min(Number(limit) || 50, 200),
      }),
    ]);

    // 规则分布与高频用户（按近段全量统计，不受 limit 影响）
    const all = await this.prisma.messageBlockEvent.findMany({
      where: { occurredAt: { gte: since } },
      select: { userId: true, matchedRule: true },
    });
    const byRule = new Map<string, number>();
    const byUser = new Map<string, number>();
    for (const e of all) {
      for (const rule of e.matchedRule.split(",")) byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
      byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + 1);
    }
    const topUserIds = [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const users = await this.prisma.user.findMany({
      where: { id: { in: topUserIds.map(([id]) => id) } },
      select: { id: true, displayName: true },
    });
    const nameMap = new Map(users.map((u) => [u.id, u.displayName]));

    const eventUserIds = [...new Set(events.map((e) => e.userId))];
    const eventUsers = await this.prisma.user.findMany({
      where: { id: { in: eventUserIds } },
      select: { id: true, displayName: true },
    });
    const eventNameMap = new Map(eventUsers.map((u) => [u.id, u.displayName]));

    return {
      sinceDays: Math.min(Number(days) || 30, 365),
      total,
      byRule: [...byRule.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
      topUsers: topUserIds.map(([id, count]) => ({ displayName: nameMap.get(id) ?? id.slice(0, 8), count })),
      recent: events.map((e) => ({
        id: e.id,
        displayName: eventNameMap.get(e.userId) ?? e.userId.slice(0, 8),
        matchedRule: e.matchedRule,
        excerpt: e.rawExcerpt,
        occurredAt: e.occurredAt,
      })),
    };
  }
}
