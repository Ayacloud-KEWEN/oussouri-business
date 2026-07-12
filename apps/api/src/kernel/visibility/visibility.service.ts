import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { VisibilityEffect } from "@prisma/client";

export interface EffectivePolicy {
  field: string;
  effect: VisibilityEffect;
  maskPattern: string | null;
}

const CACHE_TTL_MS = 60_000;
const MASK_DEFAULT = "▇▇▇";

/**
 * 可见性策略（VisibilityPolicy 表驱动，R2）：
 * 作为码层身份防火墙之上的第二道数据化防线——按 资源×字段×角色 配置 DENY/MASK。
 * 语义：未配置的字段不受影响（码层视图仍是第一道防线）；
 * 多角色取最宽（任一角色 ALLOW 即放行），命中 DENY 删字段、MASK 打码。
 * 角色特殊值："ANONYMOUS" 匹配未登录，"*" 匹配所有角色。
 */
@Injectable()
export class VisibilityService {
  private cache = new Map<string, { at: number; rows: { field: string; role: string; effect: VisibilityEffect; maskPattern: string | null }[] }>();

  constructor(private readonly prisma: PrismaService) {}

  private async policiesFor(resource: string) {
    const hit = this.cache.get(resource);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;
    const rows = await this.prisma.visibilityPolicy.findMany({
      where: { resource, deletedAt: null },
      select: { field: true, role: true, effect: true, maskPattern: true },
    });
    this.cache.set(resource, { at: Date.now(), rows });
    return rows;
  }

  /** 计算某角色集合下各字段的最终效果（最宽者胜；无策略 = 不干预） */
  private effective(rows: { field: string; role: string; effect: VisibilityEffect; maskPattern: string | null }[], roles: string[]): EffectivePolicy[] {
    const roleSet = new Set(roles.length > 0 ? [...roles, "*"] : ["ANONYMOUS", "*"]);
    const byField = new Map<string, EffectivePolicy>();
    const rank: Record<VisibilityEffect, number> = { ALLOW: 3, MASK: 2, DENY: 1 };
    for (const row of rows) {
      if (!roleSet.has(row.role)) continue;
      const current = byField.get(row.field);
      if (!current || rank[row.effect] > rank[current.effect]) {
        byField.set(row.field, { field: row.field, effect: row.effect, maskPattern: row.maskPattern });
      }
    }
    return [...byField.values()].filter((p) => p.effect !== "ALLOW");
  }

  /** 深度遍历响应体，对命中字段执行 DENY（删除）/ MASK（打码） */
  async apply(resource: string, payload: unknown, roles: string[]): Promise<unknown> {
    const rows = await this.policiesFor(resource);
    if (rows.length === 0) return payload;
    const restrictions = this.effective(rows, roles);
    if (restrictions.length === 0) return payload;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      for (const r of restrictions) {
        if (r.field in obj) {
          if (r.effect === "DENY") delete obj[r.field];
          else obj[r.field] = r.maskPattern ?? MASK_DEFAULT;
        }
      }
      for (const value of Object.values(obj)) walk(value);
    };
    walk(payload);
    return payload;
  }

  // ---------- 管理端 CRUD ----------

  list() {
    return this.prisma.visibilityPolicy.findMany({
      where: { deletedAt: null },
      orderBy: [{ resource: "asc" }, { field: "asc" }, { role: "asc" }],
      select: { id: true, resource: true, field: true, role: true, effect: true, maskPattern: true, updatedAt: true },
    });
  }

  async upsert(input: { resource: string; field: string; role: string; effect: VisibilityEffect; maskPattern?: string }, actorId: string) {
    const row = await this.prisma.visibilityPolicy.upsert({
      where: { resource_field_role: { resource: input.resource, field: input.field, role: input.role } },
      create: { ...input, createdBy: actorId },
      update: { effect: input.effect, maskPattern: input.maskPattern ?? null, deletedAt: null, updatedBy: actorId, version: { increment: 1 } },
    });
    this.cache.delete(input.resource);
    return { id: row.id };
  }

  async remove(id: string, actorId: string) {
    const row = await this.prisma.visibilityPolicy.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    this.cache.delete(row.resource);
    return { ok: true };
  }
}
