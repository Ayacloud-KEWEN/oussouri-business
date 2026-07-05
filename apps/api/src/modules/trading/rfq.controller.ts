import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IsDateString, IsISO31661Alpha2, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";
import { RfqService } from "./rfq.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class CreateRfqDto {
  @IsString() categoryCode!: string;
  @IsOptional() @IsString() speciesCode?: string;
  @IsOptional() @IsString() @MaxLength(50) packSpec?: string;
  @IsNumber() @IsPositive() qty!: number;
  @IsOptional() @IsNumber() @IsPositive() targetPrice?: number;
  @IsISO31661Alpha2() destCountry!: string;
  @IsDateString() deadline!: string;
}

class QuoteDto {
  @IsNumber() @IsPositive() unitPrice!: number;
  @IsOptional() @IsNumber() @IsPositive() moq?: number;
  @IsOptional() @IsNumber() @IsPositive() leadTimeDays?: number;
  @IsOptional() @IsNumber() @IsPositive() validDays?: number;
}

@Controller()
export class RfqController {
  constructor(private readonly rfq: RfqService) {}

  @Roles("BUYER") @Post("buyer/rfqs")
  create(@Body() dto: CreateRfqDto, @CurrentUser() user: JwtPayload) {
    return this.rfq.create(dto, user);
  }

  @Roles("BUYER") @Get("buyer/rfqs")
  buyerList(@CurrentUser() user: JwtPayload) {
    return this.rfq.listForBuyer(user);
  }

  @Roles("BUYER") @Post("buyer/quotes/:id/accept")
  accept(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.rfq.acceptQuote(id, user);
  }

  @Roles("SUPPLIER") @Get("supplier/rfqs")
  supplierList(@CurrentUser() user: JwtPayload) {
    return this.rfq.listForSupplier(user);
  }

  @Roles("SUPPLIER") @Post("supplier/rfqs/:code/quotes")
  quote(@Param("code") code: string, @Body() dto: QuoteDto, @CurrentUser() user: JwtPayload) {
    return this.rfq.submitQuote(code, dto, user);
  }
}
