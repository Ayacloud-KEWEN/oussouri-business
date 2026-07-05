import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsArray, IsDateString, IsIn, IsISO31661Alpha2, IsNumber, IsObject, IsOptional, IsPositive,
  IsString, MaxLength, ValidateNested,
} from "class-validator";
import { TraceabilityService } from "./traceability.service";
import { Public } from "../iam/jwt-auth.guard";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class CreateUnitDto {
  @IsIn(["FARM", "VINEYARD", "RANCH", "WORKSHOP"]) unitType!: string;
  @IsString() @MaxLength(100) name!: string;
  @IsString() @MaxLength(300) location!: string;
  @IsISO31661Alpha2() countryIso2!: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

class CreateSubunitDto {
  @IsString() @MaxLength(50) name!: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

class CreateSourceBatchDto {
  @IsString() subunitId!: string;
  @IsString() @MaxLength(50) batchNo!: string;
  @IsOptional() @IsString() speciesCode?: string;
  @IsOptional() @IsNumber() @IsPositive() quantity?: number;
  @IsOptional() @IsNumber() @IsPositive() avgWeightKg?: number;
  @IsOptional() @IsNumber() @IsPositive() ageMonths?: number;
  @IsOptional() @IsString() @MaxLength(100) originType?: string;
  @IsOptional() @IsString() rfidStart?: string;
  @IsOptional() @IsString() rfidEnd?: string;
}

class CareRecordDto {
  @IsIn(["FEEDING", "HEALTH", "MEDICATION", "MORTALITY"]) recordType!: "FEEDING" | "HEALTH" | "MEDICATION" | "MORTALITY";
  @IsDateString() recordDate!: string;
  @IsObject() payload!: Record<string, unknown>;
  @IsOptional() @IsDateString() withdrawalUntil?: string;
  @IsOptional() @IsString() @MaxLength(50) operator?: string;
}

class StepDto {
  @IsString() @MaxLength(30) stepCode!: string;
  @IsOptional() @IsNumber() temperature?: number;
  @IsOptional() @IsString() @MaxLength(50) operator?: string;
}

class CreateProcessingDto {
  @IsOptional() @IsString() sourceBatchId?: string;
  @IsString() @MaxLength(50) batchNo!: string;
  @IsString() categoryCode!: string;
  @IsOptional() @IsString() speciesCode?: string;
  @IsNumber() @IsPositive() rawWeightKg!: number;
  @IsNumber() @IsPositive() outputWeightKg!: number;
  @IsDateString() processedAt!: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StepDto) steps?: StepDto[];
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

class QcDto {
  @IsIn(["QC_PASS", "QC_FAIL"]) qcStatus!: "QC_PASS" | "QC_FAIL";
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

@Controller()
export class TraceabilityController {
  constructor(private readonly trace: TraceabilityService) {}

  @Roles("SUPPLIER") @Post("supplier/production-units")
  createUnit(@Body() dto: CreateUnitDto, @CurrentUser() user: JwtPayload) {
    return this.trace.createUnit(dto, user);
  }

  @Roles("SUPPLIER") @Get("supplier/production-units")
  listUnits(@CurrentUser() user: JwtPayload) {
    return this.trace.listUnits(user);
  }

  @Roles("SUPPLIER") @Post("supplier/production-units/:id/subunits")
  createSubunit(@Param("id") id: string, @Body() dto: CreateSubunitDto, @CurrentUser() user: JwtPayload) {
    return this.trace.createSubunit(id, dto, user);
  }

  @Roles("SUPPLIER") @Post("supplier/source-batches")
  createSourceBatch(@Body() dto: CreateSourceBatchDto, @CurrentUser() user: JwtPayload) {
    return this.trace.createSourceBatch(dto, user);
  }

  @Roles("SUPPLIER") @Post("supplier/source-batches/:id/care-records")
  addCare(@Param("id") id: string, @Body() dto: CareRecordDto, @CurrentUser() user: JwtPayload) {
    return this.trace.addCareRecord(id, dto, user);
  }

  @Roles("SUPPLIER") @Post("supplier/processing-batches")
  createProcessing(@Body() dto: CreateProcessingDto, @CurrentUser() user: JwtPayload) {
    return this.trace.createProcessingBatch(dto, user);
  }

  @Roles("SUPPLIER") @Get("supplier/processing-batches")
  listProcessing(@CurrentUser() user: JwtPayload) {
    return this.trace.listProcessingBatches(user);
  }

  @Roles("QUALITY_INSPECTOR", "ADMIN") @Post("admin/processing-batches/:id/qc")
  qc(@Param("id") id: string, @Body() dto: QcDto, @CurrentUser() user: JwtPayload) {
    return this.trace.setQc(id, dto.qcStatus, user, dto.notes);
  }

  /** 公开脱敏溯源视图（无基地名/企业信息） */
  @Public() @Get("products/:code/trace")
  publicTrace(@Param("code") code: string) {
    return this.trace.publicTrace(code);
  }
}
