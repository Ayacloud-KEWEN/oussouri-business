import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString,
  MaxLength, ValidateNested,
} from "class-validator";
import { TradingService } from "./trading.service";
import { ContractService } from "./contract.service";
import { MilestoneService } from "./milestone.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class CartItemDto {
  @IsString() skuCode!: string;
  @IsNumber() @IsPositive() qty!: number;
}

class MilestoneDto {
  @IsString() @MaxLength(60) label!: string;
  @IsOptional() @IsNumber() percentage?: number;
  @IsOptional() @IsNumber() @IsPositive() amount?: number;
  @IsOptional() @IsString() @MaxLength(200) triggerNote?: string;
  @IsOptional() @IsBoolean() blocksShipment?: boolean;
  @IsOptional() @IsDateString() dueAt?: string;
}

class PlaceOrderDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => CartItemDto) items!: CartItemDto[];
  @IsIn(["EUR", "USD", "CNY", "GBP", "JPY"]) currency!: string;
  @IsOptional() @IsString() contractCode?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MilestoneDto) milestones?: MilestoneDto[];
  @IsOptional() @IsBoolean() sample?: boolean;
}

class PaymentTermDto {
  @IsString() @MaxLength(60) label!: string;
  @IsNumber() percentage!: number;
  @IsOptional() @IsString() @MaxLength(200) triggerNote?: string;
  @IsOptional() @IsBoolean() blocksShipment?: boolean;
}

class CreateContractDto {
  @IsString() @MaxLength(100) contractNo!: string;
  @IsString() counterpartyCode!: string;
  @IsOptional() @IsIn(["EUR", "USD", "CNY", "GBP", "JPY"]) currency?: string;
  @IsOptional() @IsNumber() @IsPositive() totalQtyKg?: number;
  @IsOptional() @IsNumber() tolerancePct?: number;
  @IsOptional() @IsNumber() @IsPositive() unitPrice?: number;
  @IsOptional() @IsIn(["EXW", "FOB", "CIF", "DDP", "DAP"]) incoterms?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentTermDto) paymentTerms?: PaymentTermDto[];
  @IsOptional() @IsDateString() signedAt?: string;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class MarkPaidDto {
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class TransitionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@Controller()
export class TradingController {
  constructor(
    private readonly trading: TradingService,
    private readonly contracts: ContractService,
    private readonly milestoneService: MilestoneService,
  ) {}

  // 购物车
  @Roles("BUYER") @Get("buyer/cart")
  cart(@CurrentUser() user: JwtPayload) {
    return this.trading.getCart(user);
  }

  @Roles("BUYER") @Post("buyer/cart/items")
  addItem(@Body() dto: CartItemDto, @CurrentUser() user: JwtPayload) {
    return this.trading.addToCart(dto.skuCode, dto.qty, user);
  }

  // 订单
  @Roles("BUYER") @Post("buyer/orders")
  place(@Body() dto: PlaceOrderDto, @CurrentUser() user: JwtPayload) {
    return this.trading.placeOrders(dto, user);
  }

  @Roles("BUYER") @Get("buyer/orders")
  buyerOrders(@CurrentUser() user: JwtPayload) {
    return this.trading.listOrders(user, "buyer");
  }

  @Roles("SUPPLIER") @Get("supplier/orders")
  supplierOrders(@CurrentUser() user: JwtPayload) {
    return this.trading.listOrders(user, "supplier");
  }

  /** 订单详情（买卖双方与内部角色共用；对手方仅输出平台代码） */
  @Get("orders/:code")
  orderDetail(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.trading.getOrderDetail(code, user);
  }

  // ---- 框架合同（R1.5-2） ----
  @Roles("BUYER", "SUPPLIER")
  @Post("contracts")
  createContract(@Body() dto: CreateContractDto, @CurrentUser() user: JwtPayload) {
    return this.contracts.create(dto, user);
  }

  @Get("contracts")
  listContracts(@CurrentUser() user: JwtPayload) {
    return this.contracts.list(user);
  }

  // ---- 付款里程碑（R1.5-1） ----
  @Get("orders/:code/milestones")
  milestones(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.milestoneService.listForOrder(code, user);
  }

  /** 线下电汇到账登记（供应商或平台财务） */
  @Roles("SUPPLIER", "FINANCE", "ADMIN")
  @Post("milestones/:id/mark-paid")
  markMilestonePaid(@Param("id") id: string, @Body() dto: MarkPaidDto, @CurrentUser() user: JwtPayload) {
    return this.milestoneService.markPaid(id, user, dto.note);
  }

  @Roles("BUYER") @Post("buyer/orders/:code/cancel")
  cancel(@Param("code") code: string, @Body() dto: TransitionDto, @CurrentUser() user: JwtPayload) {
    return this.trading.transition(code, "CANCELLED", user, { reason: dto.reason });
  }

  @Roles("SUPPLIER") @Post("supplier/orders/:code/confirm")
  confirm(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.trading.transition(code, "CONFIRMED", user);
  }

  @Roles("SUPPLIER") @Post("supplier/orders/:code/prepare")
  prepare(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.trading.transition(code, "PREPARING", user);
  }

  @Roles("SUPPLIER") @Post("supplier/orders/:code/ship")
  ship(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.trading.transition(code, "SHIPPED", user);
  }

  @Roles("BUYER") @Post("buyer/orders/:code/confirm-delivery")
  confirmDelivery(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.trading.transition(code, "DELIVERED", user);
  }
}
