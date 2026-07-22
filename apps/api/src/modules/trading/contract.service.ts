import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CodeGeneratorService } from "../../kernel/codegen/code-generator.service";
import { AuditService } from "../../kernel/audit/audit.service";
import type { JwtPayload } from "../iam/auth.types";

/** 付款条款模板：每期占比 + 触发说明 + 是否为发货前必付 */
export interface PaymentTermTemplate {
  label: string;
  percentage: number;
  triggerNote?: string;
  blocksShipment?: boolean;
}

export interface CreateContractInput {
  contractNo: string;
  counterpartyCode: string;
  currency?: string;
  totalQtyKg?: number;
  tolerancePct?: number;
  unitPrice?: number;
  incoterms?: string;
  paymentTerms?: PaymentTermTemplate[];
  signedAt?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
}

/**
 * 框架合同（R1.5-2）：一年期总量框架 + 分批补充协议。
 * 真实场景：合同锁定单价与总量（±5% 浮动），分批发货各自开票，付款条款在合同层定义、
 * 下单时展开为订单里程碑（R1.5-1）。
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codegen: CodeGeneratorService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateContractInput, user: JwtPayload) {
    if (!user.orgId) throw new ForbiddenException({ code: "PERM_DENIED", detail: "需要交易主体身份" });
    const counterparty = await this.prisma.organization.findFirst({
      where: { publicCode: input.counterpartyCode, deletedAt: null },
    });
    if (!counterparty) throw new NotFoundException({ code: "NOT_FOUND", detail: "对手方不存在" });

    const isBuyer = user.roles.includes("BUYER");
    const buyerOrgId = isBuyer ? user.orgId : counterparty.id;
    const supplierOrgId = isBuyer ? counterparty.id : user.orgId;
    this.assertTermsSum(input.paymentTerms);

    const code = await this.codegen.next("CONTRACT");
    const contract = await this.prisma.tradeContract.create({
      data: {
        publicCode: code,
        contractNo: input.contractNo,
        buyerOrgId,
        supplierOrgId,
        currency: input.currency ?? "EUR",
        totalQtyKg: input.totalQtyKg != null ? new Prisma.Decimal(input.totalQtyKg) : null,
        tolerancePct: new Prisma.Decimal(input.tolerancePct ?? 0),
        unitPrice: input.unitPrice != null ? new Prisma.Decimal(input.unitPrice) : null,
        incoterms: input.incoterms,
        paymentTerms: (input.paymentTerms ?? undefined) as Prisma.InputJsonValue | undefined,
        signedAt: input.signedAt ? new Date(input.signedAt) : undefined,
        effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : undefined,
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : undefined,
        status: input.signedAt ? "ACTIVE" : "DRAFT",
        notes: input.notes,
        createdBy: user.sub,
      },
    });
    await this.audit.log({
      actorId: user.sub, actorRole: user.roles.join(","), action: "CONTRACT_CREATED",
      targetType: "TradeContract", targetId: contract.id, diff: { contractNo: contract.contractNo, code },
    });
    return { code: contract.publicCode, contractNo: contract.contractNo, status: contract.status };
  }

  /** 合同列表（本组织为任一方）+ 已履约量汇总 */
  async list(user: JwtPayload) {
    if (!user.orgId) return [];
    const contracts = await this.prisma.tradeContract.findMany({
      where: { deletedAt: null, OR: [{ buyerOrgId: user.orgId }, { supplierOrgId: user.orgId }] },
      orderBy: { createdAt: "desc" },
    });
    if (contracts.length === 0) return [];

    const orders = await this.prisma.tradeOrder.findMany({
      where: { contractId: { in: contracts.map((c) => c.id) }, deletedAt: null, status: { not: "CANCELLED" } },
      include: { items: { where: { deletedAt: null }, select: { qty: true } } },
    });

    return contracts.map((c) => {
      const mine = orders.filter((o) => o.contractId === c.id);
      const shippedQty = mine.reduce(
        (sum, o) => sum.plus(o.items.reduce((s, i) => s.plus(i.qty), new Prisma.Decimal(0))),
        new Prisma.Decimal(0),
      );
      const isBuyer = c.buyerOrgId === user.orgId;
      return {
        code: c.publicCode,
        contractNo: c.contractNo,
        side: isBuyer ? "BUYER" : "SUPPLIER",
        currency: c.currency,
        totalQtyKg: c.totalQtyKg,
        tolerancePct: c.tolerancePct,
        unitPrice: c.unitPrice,
        incoterms: c.incoterms,
        paymentTerms: c.paymentTerms,
        signedAt: c.signedAt,
        effectiveFrom: c.effectiveFrom,
        effectiveTo: c.effectiveTo,
        status: c.status,
        notes: c.notes,
        // 分批履历
        orderCount: mine.length,
        fulfilledQtyKg: shippedQty,
        remainingQtyKg: c.totalQtyKg ? c.totalQtyKg.mul(new Prisma.Decimal(1).plus(c.tolerancePct.div(100))).minus(shippedQty) : null,
        orders: mine.map((o) => ({ code: o.publicCode, status: o.status, grandTotal: o.grandTotal, placedAt: o.placedAt })),
      };
    });
  }

  /** 下单时校验框架总量（含浮动上限）并返回合同 */
  async assertCapacity(contractId: string, addQtyKg: Prisma.Decimal, orgId: string) {
    const contract = await this.prisma.tradeContract.findFirst({ where: { id: contractId, deletedAt: null } });
    if (!contract) throw new NotFoundException({ code: "NOT_FOUND", detail: "合同不存在" });
    if (contract.buyerOrgId !== orgId && contract.supplierOrgId !== orgId) {
      throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "非本组织合同" });
    }
    if (contract.status !== "ACTIVE") {
      throw new BadRequestException({ code: "VALIDATION_FAILED", detail: `合同状态为 ${contract.status}，不可下单` });
    }
    if (contract.effectiveTo && contract.effectiveTo < new Date()) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", detail: "合同已过有效期" });
    }
    if (contract.totalQtyKg) {
      const orders = await this.prisma.tradeOrder.findMany({
        where: { contractId, deletedAt: null, status: { not: "CANCELLED" } },
        include: { items: { where: { deletedAt: null }, select: { qty: true } } },
      });
      const used = orders.reduce(
        (sum, o) => sum.plus(o.items.reduce((s, i) => s.plus(i.qty), new Prisma.Decimal(0))),
        new Prisma.Decimal(0),
      );
      // 合同允许 ±tolerance% 浮动，按上限校验
      const cap = contract.totalQtyKg.mul(new Prisma.Decimal(1).plus(contract.tolerancePct.div(100)));
      if (used.plus(addQtyKg).gt(cap)) {
        throw new BadRequestException({
          code: "CONTRACT_QUOTA_EXCEEDED",
          detail: `超出合同总量：上限 ${cap} kg，已用 ${used} kg，本单 ${addQtyKg} kg`,
        });
      }
    }
    return contract;
  }

  private assertTermsSum(terms?: PaymentTermTemplate[]): void {
    if (!terms?.length) return;
    const sum = terms.reduce((s, t) => s + t.percentage, 0);
    if (Math.abs(sum - 100) > 0.01) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", detail: `付款条款占比合计需为 100%，当前 ${sum}%` });
    }
  }
}
