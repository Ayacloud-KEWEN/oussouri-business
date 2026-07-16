import { BadRequestException, Body, Controller, Get, Put } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { Public } from "../iam/jwt-auth.guard";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

/** 门户可配置项存放于 ConfigEntry(namespace='portal')；当前仅产业洞察一项 */
const PORTAL_NS = "portal";
const INSIGHTS_KEY = "industry-insights";

/**
 * 公开市场数据（M21 前哨，P3 接外部贸易数据前先用平台自身真实数据）：
 * - /market/insights：按品种聚合的实时行情（在售 EUR 均价 + 近 7 天 vs 前 7 天成交价趋势）
 * - /market/stats：平台实时统计（供应商/买家/SKU/成交单数）
 * 全部为脱敏聚合值，不暴露任何单一主体信息。
 */
@Controller("market")
export class MarketController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 首页「产业与市场洞察」覆盖配置（无配置时返回 null，前端回退内置默认值） */
  @Public()
  @Get("portal-config")
  async portalConfig() {
    const entry = await this.prisma.configEntry.findFirst({
      where: { namespace: PORTAL_NS, key: INSIGHTS_KEY, deletedAt: null },
    });
    return { insights: entry?.value ?? null, updatedAt: entry?.updatedAt ?? null };
  }

  @Roles("ADMIN", "SUPER_ADMIN")
  @Put("portal-config")
  async updatePortalConfig(@Body() body: { insights?: unknown }, @CurrentUser() user: JwtPayload) {
    if (body?.insights !== null && (typeof body?.insights !== "object" || Array.isArray(body?.insights))) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", detail: "insights 必须为 JSON 对象或 null（null 表示恢复默认）" });
    }
    const entry = await this.prisma.configEntry.upsert({
      where: { namespace_key: { namespace: PORTAL_NS, key: INSIGHTS_KEY } },
      create: { namespace: PORTAL_NS, key: INSIGHTS_KEY, value: (body.insights ?? Prisma.JsonNull) as Prisma.InputJsonValue, createdBy: user.sub },
      update: { value: (body.insights ?? Prisma.JsonNull) as Prisma.InputJsonValue, updatedBy: user.sub, version: { increment: 1 } },
    });
    await this.audit.log({
      actorId: user.sub,
      actorRole: user.roles.join(","),
      action: "PORTAL_CONFIG_UPDATED",
      targetType: "ConfigEntry",
      targetId: entry.id,
      diff: { key: INSIGHTS_KEY, cleared: body.insights == null },
    });
    return { ok: true, updatedAt: entry.updatedAt };
  }

  @Public()
  @Get("stats")
  async stats() {
    const [suppliers, buyers, skus, deals, countries] = await Promise.all([
      this.prisma.organization.count({ where: { partyType: "SUPPLIER", status: "ACTIVE", deletedAt: null } }),
      this.prisma.organization.count({ where: { partyType: "BUYER", status: "ACTIVE", deletedAt: null } }),
      this.prisma.productSku.count({ where: { status: "ACTIVE", deletedAt: null, product: { status: "ACTIVE", deletedAt: null } } }),
      this.prisma.tradeOrder.count({ where: { deletedAt: null, status: { notIn: ["DRAFT", "CANCELLED"] } } }),
      this.prisma.organization.groupBy({ by: ["countryIso2"], where: { status: "ACTIVE", deletedAt: null } }),
    ]);
    return { suppliers, buyers, skus, deals, countries: countries.length };
  }

  @Public()
  @Get("insights")
  async insights() {
    const products = await this.prisma.product.findMany({
      where: { status: "ACTIVE", deletedAt: null, speciesCode: { not: null } },
      include: {
        skus: {
          where: { status: "ACTIVE", deletedAt: null },
          include: { priceTiers: { where: { isActive: true, deletedAt: null, currency: "EUR" } } },
        },
      },
    });

    // 按品种聚合：在售最低档均价 + 最常见规格 + 产地国
    interface SpeciesAgg { prices: number[]; specs: Map<string, number>; origins: Map<string, number> }
    const bySpecies = new Map<string, SpeciesAgg>();
    for (const p of products) {
      const entry: SpeciesAgg = bySpecies.get(p.speciesCode!) ?? { prices: [], specs: new Map(), origins: new Map() };
      for (const sku of p.skus) {
        const tier = sku.priceTiers.sort((a, b) => a.qtyMin.comparedTo(b.qtyMin))[0];
        if (tier) {
          entry.prices.push(Number(tier.unitPrice));
          entry.specs.set(sku.packSpec, (entry.specs.get(sku.packSpec) ?? 0) + 1);
        }
      }
      entry.origins.set(p.originCountry, (entry.origins.get(p.originCountry) ?? 0) + 1);
      bySpecies.set(p.speciesCode!, entry);
    }

    // 趋势：近 7 天 vs 前 7 天订单成交均价（按品种）
    const since = new Date(Date.now() - 14 * 86_400_000);
    const items = await this.prisma.orderItem.findMany({
      where: { deletedAt: null, createdAt: { gte: since }, order: { deletedAt: null, status: { notIn: ["DRAFT", "CANCELLED"] } } },
      select: { skuId: true, unitPrice: true, createdAt: true },
    });
    const skuSpecies = new Map<string, string>();
    if (items.length > 0) {
      const skus = await this.prisma.productSku.findMany({
        where: { id: { in: [...new Set(items.map((i) => i.skuId))] } },
        select: { id: true, product: { select: { speciesCode: true } } },
      });
      for (const s of skus) if (s.product.speciesCode) skuSpecies.set(s.id, s.product.speciesCode);
    }
    const trendBuckets = new Map<string, { recent: number[]; prior: number[] }>();
    const weekAgo = Date.now() - 7 * 86_400_000;
    for (const item of items) {
      const species = skuSpecies.get(item.skuId);
      if (!species) continue;
      const bucket = trendBuckets.get(species) ?? { recent: [], prior: [] };
      (item.createdAt.getTime() >= weekAgo ? bucket.recent : bucket.prior).push(Number(item.unitPrice));
      trendBuckets.set(species, bucket);
    }

    const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

    const speciesDict = await this.prisma.species.findMany({ select: { code: true, latinName: true } });
    const latinMap = new Map(speciesDict.map((s) => [s.code, s.latinName]));

    const rows = [...bySpecies.entries()]
      .filter(([, v]) => v.prices.length > 0)
      .map(([species, v]) => {
        const bucket = trendBuckets.get(species);
        let trend = 0;
        if (bucket && bucket.recent.length && bucket.prior.length) {
          trend = Number((((avg(bucket.recent) - avg(bucket.prior)) / avg(bucket.prior)) * 100).toFixed(1));
        }
        return {
          species,
          latinName: latinMap.get(species) ?? species,
          spec: top(v.specs),
          origin: top(v.origins),
          avgPriceEur: Math.round(avg(v.prices)),
          trend,
          listings: v.prices.length,
        };
      })
      .sort((a, b) => b.avgPriceEur - a.avgPriceEur)
      .slice(0, 6);

    return { updatedAt: new Date().toISOString(), live: rows.length > 0, rows };
  }
}
