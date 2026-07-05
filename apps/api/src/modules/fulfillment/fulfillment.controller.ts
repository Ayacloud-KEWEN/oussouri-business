import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayNotEmpty, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString,
  MaxLength, ValidateNested,
} from "class-validator";
import { FulfillmentService, ShipmentLegInput } from "./fulfillment.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class LegDto implements ShipmentLegInput {
  @IsIn(["AIR", "SEA", "ROAD", "RAIL", "COLD_CHAIN_LAST_MILE"]) mode!: "AIR" | "SEA" | "ROAD" | "RAIL" | "COLD_CHAIN_LAST_MILE";
  @IsString() @MaxLength(50) carrier!: string;
  @IsOptional() @IsString() @MaxLength(50) waybillNo?: string;
  @IsString() @MaxLength(10) fromCode!: string;
  @IsString() @MaxLength(10) toCode!: string;
}

class RegisterShipmentDto {
  @IsOptional() @IsIn(["EXW", "FOB", "CIF", "DDP", "DAP"]) incoterms?: string;
  @IsOptional() @IsNumber() @IsPositive() packages?: number;
  @IsOptional() @IsNumber() @IsPositive() grossWeightKg?: number;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => LegDto) legs!: LegDto[];
}

class TempEntryDto {
  @IsDateString() recordedAt!: string;
  @IsNumber() tempC!: number;
}
class TempLogsDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => TempEntryDto) entries!: TempEntryDto[];
}

class RegisterDocDto {
  @IsString() @MaxLength(50) docType!: string;
  @IsOptional() @IsString() @MaxLength(100) docNo?: string;
  @IsString() orderCode!: string;
  @IsOptional() @IsString() @MaxLength(100) issuer?: string;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}

class CreateDeclarationDto {
  @IsString() orderCode!: string;
  @IsIn(["EXPORT", "IMPORT"]) direction!: "EXPORT" | "IMPORT";
  @IsOptional() @IsString() @MaxLength(50) declarationNo?: string;
  @IsOptional() @IsString() @MaxLength(100) brokerName?: string;
}

class DeclTransitionDto {
  @IsIn(["SUBMITTED", "INSPECTION", "CLEARED", "REJECTED"]) toState!: string;
  @IsOptional() @IsString() @MaxLength(200) inspectionResult?: string;
}

class CreatePermitDto {
  @IsString() supplierOrgCode!: string;
  @IsString() @MaxLength(50) permitNo!: string;
  @IsString() speciesCode!: string;
  @IsNumber() @IsPositive() quotaKg!: number;
  @IsDateString() issueDate!: string;
  @IsDateString() expiryDate!: string;
}

class DeductDto {
  @IsNumber() @IsPositive() kg!: number;
}

@Controller()
export class FulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  // 运单与冷链
  @Roles("SUPPLIER", "LOGISTICS_OPERATOR", "ADMIN")
  @Post("supplier/orders/:code/shipment")
  registerShipment(@Param("code") code: string, @Body() dto: RegisterShipmentDto, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.registerShipment(code, dto, user);
  }

  @Get("orders/:code/shipment")
  shipment(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.getShipment(code, user);
  }

  @Roles("SUPPLIER", "LOGISTICS_OPERATOR", "ADMIN")
  @Post("logistics/orders/:code/temperature-logs")
  tempLogs(@Param("code") code: string, @Body() dto: TempLogsDto, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.addTemperatureLogs(code, dto.entries, user);
  }

  // 单证
  @Roles("SUPPLIER", "CUSTOMS_OFFICER", "ADMIN")
  @Post("documents")
  registerDoc(@Body() dto: RegisterDocDto, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.registerDocument(dto, user);
  }

  @Get("orders/:code/doc-checklist")
  checklist(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.docChecklist(code, user);
  }

  // 清关
  @Roles("CUSTOMS_OFFICER", "ADMIN")
  @Post("customs/declarations")
  createDeclaration(@Body() dto: CreateDeclarationDto, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.createDeclaration(dto, user);
  }

  @Roles("CUSTOMS_OFFICER", "ADMIN")
  @Post("customs/declarations/:id/transition")
  transitionDeclaration(@Param("id") id: string, @Body() dto: DeclTransitionDto, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.transitionDeclaration(id, dto.toState, user, dto.inspectionResult);
  }

  // CITES
  @Roles("SUPPLIER", "CUSTOMS_OFFICER", "ADMIN")
  @Post("customs/cites-permits")
  createPermit(@Body() dto: CreatePermitDto, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.createCitesPermit(dto, user);
  }

  @Roles("CUSTOMS_OFFICER", "ADMIN")
  @Post("customs/cites-permits/:permitNo/deduct")
  deduct(@Param("permitNo") permitNo: string, @Body() dto: DeductDto, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.deductCites(permitNo, dto.kg, user);
  }

  @Roles("SUPPLIER", "CUSTOMS_OFFICER", "ADMIN")
  @Get("customs/cites-permits")
  permits(@Query("filter[expiringDays]") expiringDays: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.fulfillment.listCitesPermits(expiringDays ? Number(expiringDays) : undefined, user);
  }
}
