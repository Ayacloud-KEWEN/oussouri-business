import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";
import { CertExpiryService } from "./cert-expiry.service";
import { GdprService, type DsrType } from "./gdpr.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class ExpiringQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

class DsrSubmitDto {
  @IsIn(["EXPORT", "DELETE"]) requestType!: DsrType;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class DsrRejectDto {
  @IsString() @MaxLength(500) reason!: string;
}

@Controller("compliance")
export class ComplianceController {
  constructor(
    private readonly certExpiry: CertExpiryService,
    private readonly gdpr: GdprService,
  ) {}

  /** 内部合规看板：全平台到期清单 */
  @Roles("QUALITY_INSPECTOR", "ADMIN")
  @Get("certificates/expiring")
  expiring(@Query() query: ExpiringQueryDto) {
    return this.certExpiry.listExpiring(query.days ?? 60);
  }

  /** 持证方自查：只看本组织 */
  @Roles("SUPPLIER", "BUYER", "QUALITY_INSPECTOR", "ADMIN")
  @Get("certificates/expiring/mine")
  async myExpiring(@Query() query: ExpiringQueryDto, @CurrentUser() user: JwtPayload) {
    if (!user.orgId) return [];
    return this.certExpiry.listExpiring(query.days ?? 60, user.orgId);
  }

  /** 手动触发扫描（cron 每日 03:00 自动跑；此处供排障与演示） */
  @Roles("ADMIN")
  @Post("certificates/scan")
  scan(@CurrentUser() user: JwtPayload) {
    return this.certExpiry.runScan(user.sub);
  }

  // ---------- GDPR 数据主体请求（R1-7）----------

  /** 本人发起：任何登录用户，无需角色 */
  @Post("gdpr/requests")
  submitDsr(@Body() dto: DsrSubmitDto, @CurrentUser() user: JwtPayload) {
    return this.gdpr.submit(dto.requestType, dto.reason, user);
  }

  @Get("gdpr/requests/mine")
  myDsr(@CurrentUser() user: JwtPayload) {
    return this.gdpr.listMine(user);
  }

  @Roles("ADMIN")
  @Get("gdpr/requests")
  pendingDsr() {
    return this.gdpr.listPending();
  }

  /** 批准即执行；EXPORT 的一次性下载令牌只在此响应里出现一次 */
  @Roles("ADMIN")
  @Post("gdpr/requests/:id/approve")
  approveDsr(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.gdpr.approve(id, user);
  }

  @Roles("ADMIN")
  @Post("gdpr/requests/:id/reject")
  rejectDsr(@Param("id") id: string, @Body() dto: DsrRejectDto, @CurrentUser() user: JwtPayload) {
    return this.gdpr.reject(id, dto.reason, user);
  }

  /** 本人凭令牌取导出包（限时，令牌与本人身份双重校验） */
  @Get("gdpr/exports/:token")
  async downloadExport(@Param("token") token: string, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const obj = await this.gdpr.downloadExport(token, user);
    res.setHeader("Content-Type", obj.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(obj.filename)}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.end(obj.body);
  }
}
