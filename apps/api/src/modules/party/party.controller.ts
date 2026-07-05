import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { PartyService } from "./party.service";
import { CurrentUser, Roles } from "../iam/roles.guard";
import type { JwtPayload } from "../iam/auth.types";

class ReviewDto {
  @IsIn(["APPROVE", "REJECT"]) decision!: "APPROVE" | "REJECT";
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class EscalationDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) fields!: string[];
  @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

class DecideDto {
  @IsIn(["APPROVE", "DENY"]) decision!: "APPROVE" | "DENY";
}

class ContactDto {
  @IsString() @MaxLength(50) name!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) email?: string;
  @IsOptional() @IsString() @MaxLength(50) position?: string;
  @IsOptional() isPrimary?: boolean;
}

@Controller()
export class PartyController {
  constructor(private readonly party: PartyService) {}

  @Get("party/profile")
  profile(@CurrentUser() user: JwtPayload) {
    return this.party.myProfile(user);
  }

  @Post("party/contacts")
  addContact(@Body() dto: ContactDto, @CurrentUser() user: JwtPayload) {
    return this.party.addContact(dto, user);
  }

  @Roles("ADMIN")
  @Get("admin/parties")
  listPending(@Query("page") page = "1", @Query("pageSize") pageSize = "20") {
    return this.party.listPending(Number(page), Math.min(Number(pageSize), 100));
  }

  @Roles("ADMIN")
  @Post("admin/parties/:code/approve")
  approve(@Param("code") code: string, @Body() dto: ReviewDto, @CurrentUser() user: JwtPayload) {
    return this.party.approve(code, dto.decision, user, dto.notes);
  }

  @Roles("ADMIN", "BROKER", "FINANCE", "CUSTOMS_OFFICER")
  @Post("admin/parties/:code/escalations")
  requestEscalation(@Param("code") code: string, @Body() dto: EscalationDto, @CurrentUser() user: JwtPayload) {
    return this.party.requestEscalation(code, dto.fields, dto.reason, user);
  }

  @Roles("SUPER_ADMIN")
  @Post("admin/escalations/:id/decide")
  decide(@Param("id") id: string, @Body() dto: DecideDto, @CurrentUser() user: JwtPayload) {
    return this.party.decideEscalation(id, dto.decision, user);
  }

  @Roles("ADMIN", "BROKER", "FINANCE", "CUSTOMS_OFFICER")
  @Get("admin/parties/:code/sensitive")
  viewSensitive(@Param("code") code: string, @Query("escalationId") escalationId: string, @CurrentUser() user: JwtPayload) {
    return this.party.viewSensitive(code, escalationId, user);
  }
}
