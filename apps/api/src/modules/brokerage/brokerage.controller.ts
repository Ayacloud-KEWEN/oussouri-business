import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";
import { BrokerageService } from "./brokerage.service";
import { MatchmakingService } from "./matchmaking.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class TransitionDto {
  @IsIn(["CONTACTED", "NEGOTIATING", "WON", "LOST"]) toState!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class ActivityDto {
  @IsIn(["CALL", "MESSAGE_SENT", "DOC_SENT", "NOTE"]) activityType!: string;
  @IsString() @MaxLength(2000) note!: string;
}

class BrokerOrderDto {
  @IsString() buyerOrgCode!: string;
  @IsString() skuCode!: string;
  @IsNumber() @IsPositive() qty!: number;
  @IsNumber() @IsPositive() unitPriceEur!: number;
  @IsOptional() @IsString() opportunityCode?: string;
}

@Controller("broker")
@Roles("BROKER", "ADMIN")
export class BrokerageController {
  constructor(
    private readonly brokerage: BrokerageService,
    private readonly matchmaking: MatchmakingService,
  ) {}

  @Get("opportunities")
  list(@Query("filter[status]") status: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.brokerage.listOpportunities(status, user);
  }

  @Post("opportunities/:code/claim")
  claim(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.brokerage.claim(code, user);
  }

  @Post("opportunities/:code/transition")
  transition(@Param("code") code: string, @Body() dto: TransitionDto, @CurrentUser() user: JwtPayload) {
    return this.brokerage.transition(code, dto.toState, user, dto.reason);
  }

  @Post("opportunities/:code/activities")
  activity(@Param("code") code: string, @Body() dto: ActivityDto, @CurrentUser() user: JwtPayload) {
    return this.brokerage.addActivity(code, dto.activityType, { note: dto.note }, user);
  }

  @Post("orders")
  createOrder(@Body() dto: BrokerOrderDto, @CurrentUser() user: JwtPayload) {
    return this.brokerage.createBrokerOrder(dto, user);
  }

  /** 手动触发撮合（调试/演示；生产由 cron 驱动） */
  @Post("matchmaking/run")
  @Roles("ADMIN", "BROKER")
  async runMatchmaking() {
    const created = await this.matchmaking.runRules();
    return { created };
  }
}
