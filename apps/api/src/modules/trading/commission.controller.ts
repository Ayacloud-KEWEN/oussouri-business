import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class CreateCommissionRuleDto {
  /** 空 = 全品类默认规则 */
  @IsOptional() @IsString() @MaxLength(30) categoryCode?: string;
  @IsOptional() @IsIn(["SPOT", "RFQ", "AUCTION", "FUTURES"]) orderType?: string;
  /** 0–1 之间的小数，如 0.08 = 8% */
  @Type(() => Number) @IsNumber() @Min(0) @Max(0.5) ratePct!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(0.5) brokerFeePct?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) priority?: number;
}

/** 佣金规则配置（R2 管理后台补齐）；下单时 resolveCommissionRate 按 priority 匹配，无规则回退 8% */
@Roles("ADMIN", "FINANCE")
@Controller("admin/commission-rules")
export class CommissionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.commissionRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        categoryCode: true,
        orderType: true,
        ratePct: true,
        brokerFeePct: true,
        priority: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });
  }

  @Post()
  async create(@Body() dto: CreateCommissionRuleDto, @CurrentUser() user: JwtPayload) {
    const rule = await this.prisma.commissionRule.create({
      data: {
        categoryCode: dto.categoryCode || null,
        orderType: (dto.orderType as never) ?? null,
        ratePct: new Prisma.Decimal(dto.ratePct.toFixed(4)),
        brokerFeePct: dto.brokerFeePct !== undefined ? new Prisma.Decimal(dto.brokerFeePct.toFixed(4)) : null,
        priority: dto.priority ?? 0,
        effectiveFrom: new Date(),
        createdBy: user.sub,
      },
    });
    await this.audit.log({
      actorId: user.sub,
      actorRole: user.roles.join(","),
      action: "COMMISSION_RULE_CREATED",
      targetType: "CommissionRule",
      targetId: rule.id,
      diff: { categoryCode: dto.categoryCode ?? null, ratePct: dto.ratePct, priority: dto.priority ?? 0 },
    });
    return { id: rule.id };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    await this.prisma.commissionRule.update({
      where: { id },
      data: { deletedAt: new Date(), effectiveTo: new Date(), updatedBy: user.sub, version: { increment: 1 } },
    });
    await this.audit.log({
      actorId: user.sub,
      actorRole: user.roles.join(","),
      action: "COMMISSION_RULE_DELETED",
      targetType: "CommissionRule",
      targetId: id,
    });
    return { ok: true };
  }
}
