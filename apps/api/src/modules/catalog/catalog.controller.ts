import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayNotEmpty, IsArray, IsIn, IsISO31661Alpha2, IsNumber, IsObject, IsOptional, IsPositive, IsString,
  MaxLength, Min, ValidateNested,
} from "class-validator";
import { CatalogService } from "./catalog.service";
import { Public } from "../iam/jwt-auth.guard";
import { VisibilityResource } from "../../kernel/visibility/visibility.interceptor";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class CreateProductDto {
  @IsString() categoryCode!: string;
  @IsOptional() @IsString() speciesCode?: string;
  @IsOptional() @IsString() gradeCode?: string;
  @IsString() @MaxLength(20) hsCode!: string;
  @IsISO31661Alpha2() originCountry!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsIn(["zh-CN", "en", "fr"]) sourceLocale?: string;
}

class PriceTierDto {
  @IsIn(["EUR", "USD", "CNY", "GBP", "JPY"]) currency!: string;
  @IsNumber() @Min(0) qtyMin!: number;
  @IsOptional() @IsNumber() @IsPositive() qtyMax?: number;
  @IsNumber() @IsPositive() unitPrice!: number;
}

class CreateSkuDto {
  @IsString() @MaxLength(50) packSpec!: string;
  @IsNumber() @IsPositive() netWeightKg!: number;
  @IsString() @MaxLength(10) unit!: string;
  @IsOptional() @IsNumber() @IsPositive() moq?: number;
  @IsOptional() @IsNumber() @IsPositive() shelfLifeDays?: number;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => PriceTierDto) priceTiers!: PriceTierDto[];
}

class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() speciesCode?: string;
  @IsOptional() @IsString() gradeCode?: string;
  @IsOptional() @IsString() @MaxLength(20) hsCode?: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

class MediaDto {
  @IsString() @MaxLength(100) key!: string;
}

class ReviewDto {
  @IsIn(["APPROVE", "REJECT"]) decision!: "APPROVE" | "REJECT";
  @IsOptional() @IsString() @MaxLength(500) reasons?: string;
}

function normalizeLocale(locale?: string): string | undefined {
  return locale && ["zh-CN", "en", "fr"].includes(locale) ? locale : undefined;
}

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @VisibilityResource("Product")
  @Get("products")
  list(
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("filter[category]") category?: string,
    @Query("filter[species]") species?: string,
    @Query("q") q?: string,
    @Query("locale") locale?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    // Guard 在公共路由上已尽力解析身份（Bearer 头或 httpOnly cookie 均可）
    const authenticated = Boolean(user);
    return this.catalog.listPublic(
      { category, species, q, locale: normalizeLocale(locale), page: Number(page), pageSize: Math.min(Number(pageSize), 100) },
      authenticated,
    );
  }

  @Public()
  @VisibilityResource("Product")
  @Get("products/:code")
  get(
    @Param("code") code: string,
    @Query("locale") locale?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.catalog.getPublic(code, Boolean(user), normalizeLocale(locale));
  }

  @Roles("SUPPLIER")
  @Get("supplier/products")
  mine(@CurrentUser() user: JwtPayload) {
    return this.catalog.listSupplierProducts(user);
  }

  @Roles("SUPPLIER")
  @Post("supplier/products")
  create(@Body() dto: CreateProductDto, @CurrentUser() user: JwtPayload) {
    return this.catalog.createProduct(dto, user);
  }

  @Roles("SUPPLIER")
  @Post("supplier/products/:code/skus")
  addSku(@Param("code") code: string, @Body() dto: CreateSkuDto, @CurrentUser() user: JwtPayload) {
    return this.catalog.addSku(code, dto, user);
  }

  @Roles("SUPPLIER")
  @Post("supplier/products/:code/media")
  addMedia(@Param("code") code: string, @Body() dto: MediaDto, @CurrentUser() user: JwtPayload) {
    return this.catalog.addMedia(code, dto.key, user);
  }

  @Roles("SUPPLIER")
  @Post("supplier/products/:code/submit")
  submit(@Param("code") code: string, @CurrentUser() user: JwtPayload) {
    return this.catalog.submitForReview(code, user);
  }

  @Roles("SUPPLIER")
  @Patch("supplier/products/:code")
  update(@Param("code") code: string, @Body() dto: UpdateProductDto, @CurrentUser() user: JwtPayload) {
    return this.catalog.updateProduct(code, dto, user);
  }

  @Roles("ADMIN", "QUALITY_INSPECTOR")
  @Get("admin/products/pending")
  pendingReview() {
    return this.catalog.listPendingReview();
  }

  @Roles("ADMIN", "QUALITY_INSPECTOR")
  @Post("admin/products/:code/review")
  review(@Param("code") code: string, @Body() dto: ReviewDto, @CurrentUser() user: JwtPayload) {
    return this.catalog.review(code, dto.decision, user, dto.reasons);
  }
}
