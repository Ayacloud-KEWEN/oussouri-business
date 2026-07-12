import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { TranslationService } from "./translation.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class ReviewTranslationDto {
  /** 不传表示原样批准，传则以修改稿批准 */
  @IsOptional() @IsString() @MaxLength(8000) value?: string;
}

@Controller()
export class TranslationController {
  constructor(private readonly translation: TranslationService) {}

  @Roles("ADMIN")
  @Get("admin/translations")
  list(
    @Query("status") status = "MACHINE_DRAFT",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    const s = status === "REVIEWED" ? "REVIEWED" : "MACHINE_DRAFT";
    return this.translation.listQueue(s, Number(page), Math.min(Number(pageSize), 100));
  }

  @Roles("ADMIN")
  @Post("admin/translations/:id/review")
  review(@Param("id") id: string, @Body() dto: ReviewTranslationDto, @CurrentUser() user: JwtPayload) {
    return this.translation.review(id, dto.value, user);
  }
}
