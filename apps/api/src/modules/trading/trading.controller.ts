import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength, ValidateNested } from "class-validator";
import { TradingService } from "./trading.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class CartItemDto {
  @IsString() skuCode!: string;
  @IsNumber() @IsPositive() qty!: number;
}

class PlaceOrderDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => CartItemDto) items!: CartItemDto[];
  @IsIn(["EUR", "USD", "CNY", "GBP", "JPY"]) currency!: string;
}

class TransitionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@Controller()
export class TradingController {
  constructor(private readonly trading: TradingService) {}

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
