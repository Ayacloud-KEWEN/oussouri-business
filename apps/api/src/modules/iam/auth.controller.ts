import { Body, Controller, Get, Ip, Post } from "@nestjs/common";
import { IsEmail, IsIn, IsISO31661Alpha2, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { Public } from "./jwt-auth.guard";
import { CurrentUser } from "./roles.guard";
import type { JwtPayload } from "./auth.types";

class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
  @IsString() @MaxLength(50) displayName!: string;
  @IsOptional() @IsIn(["zh-CN", "en", "fr"]) locale?: string;
  @IsIn(["SUPPLIER", "BUYER"]) partyType!: "SUPPLIER" | "BUYER";
  @IsString() @MaxLength(200) companyName!: string;
  @IsISO31661Alpha2() countryIso2!: string;
  @IsOptional() @IsIn(["WHOLESALER", "RETAILER", "RESTAURANT", "IMPORTER", "DISTRIBUTOR"]) buyerType?: string;
}

class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

class RefreshDto {
  @IsString() refreshToken!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.auth.register(dto, ip);
  }

  @Public()
  @Post("login")
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto.email, dto.password, ip);
  }

  @Public()
  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post("logout")
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
