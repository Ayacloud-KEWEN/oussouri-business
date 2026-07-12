import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { PiiFilterService } from "../../kernel/pii/pii-filter.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { LlmPort } from "./llm.port";
import type { JwtPayload } from "../iam/auth.types";

const LOCALES = ["zh-CN", "en", "fr"] as const;
const TRANSLATED_FIELDS = ["name", "description"] as const;

/**
 * AI 翻译管道（R2）：机翻草稿 → 人工复核 → 公开展示。
 * 出站脱敏（GBR-1）：送 LLM 前先过 PiiFilterService，命中片段以 ▇ 遮盖。
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger("Translation");

  constructor(
    private readonly prisma: PrismaService,
    private readonly piiFilter: PiiFilterService,
    private readonly audit: AuditService,
    private readonly llm: LlmPort,
  ) {}

  // ---------- 机翻草稿（产品上架触发） ----------

  @OnEvent("ProductPublished")
  async onProductPublished(event: { payload: { productId: string } }): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: event.payload.productId } });
    if (!product) return;
    const source = product.sourceLocale;
    for (const field of TRANSLATED_FIELDS) {
      const text = field === "name" ? product.name : product.description;
      if (!text?.trim()) continue;
      const sanitized = this.sanitizeForLlm(text);
      for (const target of LOCALES) {
        if (target === source) continue;
        const existing = await this.prisma.entityTranslation.findUnique({
          where: { entityType_entityId_field_locale: { entityType: "Product", entityId: product.id, field, locale: target } },
        });
        if (existing && !existing.deletedAt) continue; // 不覆盖已有草稿/已复核译文
        const value = await this.llm.translate(sanitized, source, target);
        if (!value) {
          this.logger.warn(`translate skipped product=${product.publicCode} field=${field} target=${target}`);
          continue;
        }
        await this.prisma.entityTranslation.upsert({
          where: { entityType_entityId_field_locale: { entityType: "Product", entityId: product.id, field, locale: target } },
          create: { entityType: "Product", entityId: product.id, field, locale: target, value, status: "MACHINE_DRAFT" },
          update: { value, status: "MACHINE_DRAFT", deletedAt: null, version: { increment: 1 } },
        });
      }
    }
  }

  /** 送 LLM 前脱敏：PII 命中片段遮盖 */
  private sanitizeForLlm(text: string): string {
    let out = text;
    for (const match of this.piiFilter.scan(text)) {
      out = out.split(match.excerpt).join("▇▇▇");
    }
    return out;
  }

  // ---------- 复核队列（管理后台） ----------

  async listQueue(status: "MACHINE_DRAFT" | "REVIEWED", page: number, pageSize: number) {
    const where = { status, deletedAt: null } as const;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.entityTranslation.findMany({ where, orderBy: { createdAt: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.entityTranslation.count({ where }),
    ]);
    // 目前只有 Product 实体：批量取源文与产品代码
    const productIds = [...new Set(rows.filter((r) => r.entityType === "Product").map((r) => r.entityId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, publicCode: true, name: true, description: true, sourceLocale: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    return {
      data: rows.map((r) => {
        const p = r.entityType === "Product" ? productMap.get(r.entityId) : undefined;
        return {
          id: r.id,
          entityType: r.entityType,
          entityCode: p?.publicCode ?? r.entityId,
          field: r.field,
          locale: r.locale,
          value: r.value,
          status: r.status,
          sourceLocale: p?.sourceLocale ?? null,
          sourceText: p ? (r.field === "name" ? p.name : p.description) : null,
          createdAt: r.createdAt,
        };
      }),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async review(id: string, value: string | undefined, actor: JwtPayload) {
    const row = await this.prisma.entityTranslation.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", detail: "译文不存在" });
    const updated = await this.prisma.entityTranslation.update({
      where: { id },
      data: { ...(value !== undefined ? { value } : {}), status: "REVIEWED", updatedBy: actor.sub, version: { increment: 1 } },
    });
    await this.audit.log({
      actorId: actor.sub,
      actorRole: actor.roles.join(","),
      action: "TRANSLATION_REVIEWED",
      targetType: "EntityTranslation",
      targetId: id,
      diff: { locale: row.locale, field: row.field, edited: value !== undefined },
    });
    return { id: updated.id, status: updated.status };
  }

  // ---------- 公开读取（目录按 locale 覆盖） ----------

  /** 取一批实体的已复核译文：Map<entityId, Map<field, value>> */
  async reviewedFor(entityType: string, entityIds: string[], locale: string): Promise<Map<string, Map<string, string>>> {
    const result = new Map<string, Map<string, string>>();
    if (entityIds.length === 0) return result;
    const rows = await this.prisma.entityTranslation.findMany({
      where: { entityType, entityId: { in: entityIds }, locale, status: "REVIEWED", deletedAt: null },
    });
    for (const r of rows) {
      let fields = result.get(r.entityId);
      if (!fields) {
        fields = new Map();
        result.set(r.entityId, fields);
      }
      fields.set(r.field, r.value);
    }
    return result;
  }
}
