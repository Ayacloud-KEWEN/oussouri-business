import { Body, Controller, Get, Headers, Post, Query, Req } from "@nestjs/common";
import { IsOptional, IsString, IsUrl } from "class-validator";
import { SettlementService } from "./settlement.service";
import { Public } from "../iam/jwt-auth.guard";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class CheckoutDto {
  @IsString() orderCode!: string;
}

class OnboardingDto {
  /** 完成入驻后 Stripe 回跳地址（站内绝对 URL） */
  @IsUrl({ require_tld: false }) returnUrl!: string;
  @IsOptional() @IsUrl({ require_tld: false }) refreshUrl?: string;
}

@Controller()
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Roles("BUYER")
  @Post("payments/checkout")
  checkout(@Body() dto: CheckoutDto, @CurrentUser() user: JwtPayload) {
    return this.settlement.checkout(dto.orderCode, user);
  }

  @Public()
  @Post("webhooks/stripe")
  webhook(@Req() req: { rawBody?: Buffer; body?: unknown }, @Headers("stripe-signature") signature: string) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.settlement.handleWebhook(raw, signature ?? "");
  }

  /** 前端支付组件初始化配置（无真实密钥时 publishableKey 为 null → 回退模拟支付） */
  @Public()
  @Get("payments/config")
  paymentConfig() {
    return this.settlement.publicConfig();
  }

  // Connect 入驻（R1-2）
  @Roles("SUPPLIER")
  @Post("settlement/connect/onboarding")
  connectOnboarding(@Body() dto: OnboardingDto, @CurrentUser() user: JwtPayload) {
    return this.settlement.connectOnboarding(user, dto.returnUrl, dto.refreshUrl ?? dto.returnUrl);
  }

  @Roles("SUPPLIER")
  @Get("settlement/connect/status")
  connectStatus(@CurrentUser() user: JwtPayload) {
    return this.settlement.connectStatus(user);
  }

  @Roles("FINANCE", "ADMIN")
  @Get("finance/ledger")
  ledger(@Query("filter[account]") account?: string, @Query("page") page = "1", @Query("pageSize") pageSize = "50") {
    return this.settlement.ledger(account, Number(page), Math.min(Number(pageSize), 200));
  }
}
