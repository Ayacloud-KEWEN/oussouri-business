import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { VisibilityService } from "./visibility.service";
import { CurrentUser, Roles } from "../../modules/iam/roles.guard";
import type { JwtPayload } from "../../modules/iam/auth.types";
import type { VisibilityEffect } from "@prisma/client";

class UpsertPolicyDto {
  @IsString() @MaxLength(50) resource!: string;
  @IsString() @MaxLength(50) field!: string;
  /** 角色代码，或 "ANONYMOUS" / "*" */
  @IsString() @MaxLength(30) role!: string;
  @IsIn(["ALLOW", "MASK", "DENY"]) effect!: VisibilityEffect;
  @IsOptional() @IsString() @MaxLength(50) maskPattern?: string;
}

@Roles("SUPER_ADMIN")
@Controller("admin/visibility-policies")
export class VisibilityController {
  constructor(private readonly visibility: VisibilityService) {}

  @Get()
  list() {
    return this.visibility.list();
  }

  @Post()
  upsert(@Body() dto: UpsertPolicyDto, @CurrentUser() user: JwtPayload) {
    return this.visibility.upsert(dto, user.sub);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.visibility.remove(id, user.sub);
  }
}
