import { Body, Controller, Get, Headers, Post, Query, Req } from "@nestjs/common";
import { IsString } from "class-validator";
import { SettlementService } from "./settlement.service";
import { Public } from "../iam/jwt-auth.guard";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class CheckoutDto {
  @IsString() orderCode!: string;
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

  @Roles("FINANCE", "ADMIN")
  @Get("finance/ledger")
  ledger(@Query("filter[account]") account?: string, @Query("page") page = "1", @Query("pageSize") pageSize = "50") {
    return this.settlement.ledger(account, Number(page), Math.min(Number(pageSize), 200));
  }
}
