import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CodeGeneratorService } from "../../kernel/codegen/code-generator.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { OutboxService } from "../../kernel/outbox/outbox.service";
import { EmbeddingPort } from "./embedding.port";
import { TranslationService } from "../i18n/translation.service";
import type { JwtPayload } from "../iam/auth.types";

export interface CreateProductInput {
  categoryCode: string;
  speciesCode?: string;
  gradeCode?: string;
  hsCode: string;
  originCountry: string;
  name: string;
  description?: string;
  /** 结构化品质数据（营养/工艺/品鉴/搭配）；供应商身份标识（品牌名、厂址、企业名）禁止写入 */
  attributes?: Record<string, unknown>;
  sourceLocale?: string;
}

export interface CreateSkuInput {
  packSpec: string;
  netWeightKg: number;
  unit: string;
  moq?: number;
  shelfLifeDays?: number;
  priceTiers: { currency: string; qtyMin: number; qtyMax?: number; unitPrice: number }[];
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codegen: CodeGeneratorService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly embedding: EmbeddingPort,
    private readonly translation: TranslationService,
  ) {}

  // ---------- 公开目录（身份防火墙：仅供应商代码） ----------

  async listPublic(
    filters: { category?: string; species?: string; q?: string; locale?: string; page: number; pageSize: number },
    authenticated: boolean,
  ) {
    const where: Prisma.ProductWhereInput = {
      status: "ACTIVE",
      deletedAt: null,
      ...(filters.category ? { categoryCode: filters.category } : {}),
      ...(filters.species ? { speciesCode: { in: filters.species.split(",") } } : {}),
    };

    // 关键词搜索：先取按相关度排序的 id 列表，再分页装配（语义优先，未配置向量则全文）
    let rankedIds: string[] | null = null;
    if (filters.q?.trim()) {
      rankedIds = await this.searchProductIds(filters.q.trim().slice(0, 100));
      if (rankedIds.length === 0) {
        return { data: [], meta: { page: filters.page, pageSize: filters.pageSize, total: 0, totalPages: 0 } };
      }
      where.id = { in: rankedIds };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        ...(rankedIds ? {} : { orderBy: { publishedAt: "desc" } as const, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
        include: {
          skus: { where: { status: "ACTIVE", deletedAt: null }, include: { priceTiers: { where: { isActive: true, deletedAt: null } } } },
          media: { where: { deletedAt: null, kind: "IMAGE" }, orderBy: { sortOrder: "asc" }, take: 1 },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    // 搜索模式：按相关度重排后在内存分页（结果集受 SEARCH_LIMIT 约束）
    const ordered = rankedIds
      ? rankedIds
          .map((id) => rows.find((r) => r.id === id))
          .filter((r): r is (typeof rows)[number] => Boolean(r))
          .slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize)
      : rows;
    const supplierCodes = await this.supplierCodeMap(ordered.map((r) => r.supplierOrgId));
    const translations = filters.locale
      ? await this.translation.reviewedFor("Product", ordered.map((r) => r.id), filters.locale)
      : new Map<string, Map<string, string>>();
    return {
      data: ordered.map((p) => this.toPublicView(p, supplierCodes, authenticated, translations.get(p.id))),
      meta: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) },
    };
  }

  private static readonly SEARCH_LIMIT = 200;

  /** 相关度排序的产品 id：pgvector 语义（embedding 提供方已配置且有索引数据）→ 否则 tsvector 全文 + trigram/子串 */
  private async searchProductIds(q: string): Promise<string[]> {
    const vector = await this.embedding.embed(q);
    if (vector) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p."id", MIN(e."embedding" <=> ${`[${vector.join(",")}]`}::vector) AS dist
        FROM "core"."product_embeddings" e
        JOIN "core"."product_skus" s ON s."id" = e."skuId"
        JOIN "core"."products" p ON p."id" = s."productId"
        WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
        GROUP BY p."id"
        ORDER BY dist
        LIMIT ${CatalogService.SEARCH_LIMIT}
      `;
      if (rows.length > 0) return rows.map((r) => r.id);
    }
    // 中文无空格分词：整串子串命中 OR（按空白拆词后逐词子串 AND）OR tsvector 全文（西文词形）
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);
    const termMatch = (t: string) => {
      const p = `%${t}%`;
      return Prisma.sql`("name" ILIKE ${p} OR coalesce("description",'') ILIKE ${p} OR coalesce("speciesCode",'') ILIKE ${p} OR coalesce("gradeCode",'') ILIKE ${p})`;
    };
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "core"."products"
      WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL
        AND (
          to_tsvector('simple', coalesce("name",'') || ' ' || coalesce("description",'')) @@ websearch_to_tsquery('simple', ${q})
          OR ${termMatch(q)}
          OR (${Prisma.join(terms.map(termMatch), " AND ")})
        )
      ORDER BY similarity("name", ${q}) DESC, "publishedAt" DESC NULLS LAST
      LIMIT ${CatalogService.SEARCH_LIMIT}
    `;
    return rows.map((r) => r.id);
  }

  async getPublic(publicCode: string, authenticated: boolean, locale?: string) {
    const product = await this.prisma.product.findFirst({
      where: { publicCode, status: "ACTIVE", deletedAt: null },
      include: {
        skus: { where: { status: "ACTIVE", deletedAt: null }, include: { priceTiers: { where: { isActive: true, deletedAt: null } } } },
        media: { where: { deletedAt: null, kind: "IMAGE" }, orderBy: { sortOrder: "asc" }, take: 1 },
      },
    });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", detail: "产品不存在" });
    const supplierCodes = await this.supplierCodeMap([product.supplierOrgId]);
    const translations = locale ? await this.translation.reviewedFor("Product", [product.id], locale) : undefined;
    return this.toPublicView(product, supplierCodes, authenticated, translations?.get(product.id));
  }

  private async supplierCodeMap(orgIds: string[]): Promise<Map<string, string>> {
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: [...new Set(orgIds)] } },
      select: { id: true, publicCode: true },
    });
    return new Map(orgs.map((o) => [o.id, o.publicCode]));
  }

  /** 公开视图：绝不输出 supplierOrgId/originDetail/内部 UUID；未登录不给价格（BR-01-01） */
  private toPublicView(
    product: Prisma.ProductGetPayload<{ include: { skus: { include: { priceTiers: true } }; media: true } }>,
    supplierCodes: Map<string, string>,
    authenticated: boolean,
    translated?: Map<string, string>,
  ) {
    return {
      code: product.publicCode,
      image: product.media[0] ? `/api/v1/files/${product.media[0].fileKey}` : null,
      name: translated?.get("name") ?? product.name,
      description: translated?.get("description") ?? product.description,
      // 结构化品质数据（营养/工艺/品鉴）：内容侧已保证不含供应商身份标识
      attributes: product.attributes,
      category: product.categoryCode,
      species: product.speciesCode,
      grade: product.gradeCode,
      originCountry: product.originCountry,
      supplierCode: supplierCodes.get(product.supplierOrgId) ?? "UNKNOWN",
      skus: product.skus.map((s) => ({
        skuCode: s.skuCode,
        packSpec: s.packSpec,
        netWeightKg: s.netWeightKg,
        unit: s.unit,
        moq: s.moq,
        priceTiers: authenticated
          ? s.priceTiers.map((t) => ({ currency: t.currency, qtyMin: t.qtyMin, qtyMax: t.qtyMax, unitPrice: t.unitPrice }))
          : "LOGIN_REQUIRED",
      })),
    };
  }

  // ---------- 供应商端 ----------

  async createProduct(input: CreateProductInput, user: JwtPayload) {
    this.assertSupplier(user);
    return this.prisma.$transaction(async (tx) => {
      const code = await this.codegen.next("PRODUCT", tx);
      const product = await tx.product.create({
        data: {
          publicCode: code,
          supplierOrgId: user.orgId!,
          categoryCode: input.categoryCode,
          speciesCode: input.speciesCode,
          gradeCode: input.gradeCode,
          hsCode: input.hsCode,
          originCountry: input.originCountry.toUpperCase(),
          name: input.name,
          description: input.description,
          attributes: (input.attributes ?? undefined) as Prisma.InputJsonValue | undefined,
          sourceLocale: input.sourceLocale ?? "zh-CN",
          createdBy: user.sub,
        },
      });
      await this.audit.logInTx(tx, { actorId: user.sub, action: "CREATE", targetType: "Product", targetId: product.id });
      return { code: product.publicCode, status: product.status };
    });
  }

  async addSku(productCode: string, input: CreateSkuInput, user: JwtPayload) {
    const product = await this.ownedProduct(productCode, user);
    const skuCode = `${product.publicCode}-${input.packSpec.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
    return this.prisma.$transaction(async (tx) => {
      const sku = await tx.productSku.create({
        data: {
          productId: product.id,
          skuCode,
          packSpec: input.packSpec,
          netWeightKg: new Prisma.Decimal(input.netWeightKg),
          unit: input.unit,
          moq: new Prisma.Decimal(input.moq ?? 1),
          shelfLifeDays: input.shelfLifeDays,
          createdBy: user.sub,
        },
      });
      await tx.priceTier.createMany({
        data: input.priceTiers.map((t) => ({
          skuId: sku.id,
          currency: t.currency,
          qtyMin: new Prisma.Decimal(t.qtyMin),
          qtyMax: t.qtyMax != null ? new Prisma.Decimal(t.qtyMax) : null,
          unitPrice: new Prisma.Decimal(t.unitPrice),
          effectiveFrom: new Date(),
          createdBy: user.sub,
        })),
      });
      return { skuCode: sku.skuCode };
    });
  }

  /** 产品照片（重传即替换旧主图；key 来自 POST /files/upload） */
  async addMedia(productCode: string, key: string, user: JwtPayload) {
    const product = await this.ownedProduct(productCode, user);
    await this.prisma.$transaction([
      this.prisma.productMedia.updateMany({
        where: { productId: product.id, kind: "IMAGE", deletedAt: null },
        data: { deletedAt: new Date() },
      }),
      this.prisma.productMedia.create({
        data: { productId: product.id, kind: "IMAGE", fileKey: key, sortOrder: 0 },
      }),
    ]);
    return { code: productCode, replaced: true };
  }

  /**
   * 供应商编辑产品：DRAFT 自由改；ACTIVE 改动后自动转 PENDING_REVIEW 重新送审
   * （防止上架后偷换关键信息，M04 审核闭环）。
   */
  async updateProduct(
    productCode: string,
    input: { name?: string; description?: string; speciesCode?: string; gradeCode?: string; hsCode?: string; attributes?: Record<string, unknown> },
    user: JwtPayload,
  ) {
    const product = await this.ownedProduct(productCode, user);
    if (!["DRAFT", "ACTIVE", "PENDING_REVIEW"].includes(product.status)) {
      throw new ForbiddenException({ code: "STATE_TRANSITION_DENIED", detail: "当前状态不可编辑" });
    }
    const needsReview = product.status === "ACTIVE";
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: product.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.speciesCode !== undefined ? { speciesCode: input.speciesCode } : {}),
          ...(input.gradeCode !== undefined ? { gradeCode: input.gradeCode } : {}),
          ...(input.hsCode !== undefined ? { hsCode: input.hsCode } : {}),
          ...(input.attributes !== undefined ? { attributes: input.attributes as Prisma.InputJsonValue } : {}),
          ...(needsReview ? { status: "PENDING_REVIEW" } : {}),
          updatedBy: user.sub,
          version: { increment: 1 },
        },
      });
      await this.audit.logInTx(tx, {
        actorId: user.sub,
        action: "UPDATE",
        targetType: "Product",
        targetId: product.id,
        diff: { fields: Object.keys(input), resubmitted: needsReview },
      });
    });
    return { code: productCode, status: needsReview ? "PENDING_REVIEW" : product.status, resubmitted: needsReview };
  }

  /** 管理员/质检待审列表（含供应商代码与详情，免手输编号） */
  async listPendingReview() {
    const products = await this.prisma.product.findMany({
      where: { status: "PENDING_REVIEW", deletedAt: null },
      orderBy: { updatedAt: "asc" },
      include: {
        skus: { where: { deletedAt: null }, include: { priceTiers: { where: { isActive: true, deletedAt: null } } } },
        media: { where: { deletedAt: null, kind: "IMAGE" }, orderBy: { sortOrder: "asc" }, take: 1 },
      },
    });
    const supplierCodes = await this.supplierCodeMap(products.map((p) => p.supplierOrgId));
    return products.map((p) => ({
      code: p.publicCode,
      name: p.name,
      description: p.description,
      categoryCode: p.categoryCode,
      speciesCode: p.speciesCode,
      gradeCode: p.gradeCode,
      hsCode: p.hsCode,
      supplierCode: supplierCodes.get(p.supplierOrgId),
      image: p.media[0] ? `/api/v1/files/${p.media[0].fileKey}` : null,
      skus: p.skus.map((s) => ({
        skuCode: s.skuCode,
        packSpec: s.packSpec,
        moq: s.moq,
        priceTiers: s.priceTiers.map((t) => ({ currency: t.currency, qtyMin: t.qtyMin, qtyMax: t.qtyMax, unitPrice: t.unitPrice })),
      })),
      submittedAt: p.updatedAt,
    }));
  }

  async submitForReview(productCode: string, user: JwtPayload) {
    const product = await this.ownedProduct(productCode, user);
    if (product.status !== "DRAFT") {
      throw new ForbiddenException({ code: "STATE_TRANSITION_DENIED", detail: "仅草稿可提交审核" });
    }
    await this.prisma.product.update({ where: { id: product.id }, data: { status: "PENDING_REVIEW", version: { increment: 1 } } });
    return { code: productCode, status: "PENDING_REVIEW" };
  }

  async review(productCode: string, decision: "APPROVE" | "REJECT", user: JwtPayload, reasons?: string) {
    const product = await this.prisma.product.findFirst({ where: { publicCode: productCode, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", detail: "产品不存在" });
    const status = decision === "APPROVE" ? "ACTIVE" : "DRAFT";
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: product.id },
        data: { status, publishedAt: decision === "APPROVE" ? new Date() : null, updatedBy: user.sub, version: { increment: 1 } },
      });
      await this.audit.logInTx(tx, {
        actorId: user.sub,
        actorRole: user.roles.join(","),
        action: "PRODUCT_REVIEW",
        targetType: "Product",
        targetId: product.id,
        diff: { decision },
        reason: reasons,
      });
      if (decision === "APPROVE") {
        await this.outbox.emitInTx(tx, `Product:${product.id}`, "ProductPublished", { productId: product.id, code: product.publicCode });
      }
    });
    return { code: productCode, status };
  }

  async listSupplierProducts(user: JwtPayload) {
    this.assertSupplier(user);
    const rows = await this.prisma.product.findMany({
      where: { supplierOrgId: user.orgId!, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { skus: { where: { deletedAt: null } } },
    });
    return rows.map((p) => ({
      code: p.publicCode, name: p.name, description: p.description, status: p.status,
      attributes: p.attributes, skuCount: p.skus.length,
    }));
  }

  private async ownedProduct(publicCode: string, user: JwtPayload) {
    this.assertSupplier(user);
    const product = await this.prisma.product.findFirst({ where: { publicCode, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", detail: "产品不存在" });
    if (product.supplierOrgId !== user.orgId) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "只能操作本组织产品" });
    }
    return product;
  }

  private assertSupplier(user: JwtPayload): void {
    if (!user.orgId || !user.roles.includes("SUPPLIER")) {
      throw new ForbiddenException({ code: "PERM_DENIED", detail: "需要供应商身份" });
    }
  }
}
