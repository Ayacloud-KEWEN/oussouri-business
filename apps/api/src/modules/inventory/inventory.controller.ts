import { Body, Controller, Get, Post } from "@nestjs/common";
import { IsDateString, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";
import { InventoryService } from "./inventory.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class InboundDto {
  @IsString() skuCode!: string;
  @IsString() @MaxLength(50) lotNo!: string;
  @IsNumber() @IsPositive() qty!: number;
  @IsDateString() producedAt!: string;
  @IsDateString() expiresAt!: string;
  @IsOptional() @IsString() @MaxLength(50) warehouse?: string;
}

@Controller("supplier/inventory")
@Roles("SUPPLIER")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("lots")
  lots(@CurrentUser() user: JwtPayload) {
    return this.inventory.listSupplierLots(user);
  }

  @Post("lots")
  inbound(@Body() dto: InboundDto, @CurrentUser() user: JwtPayload) {
    return this.inventory.inbound(dto, user);
  }
}
