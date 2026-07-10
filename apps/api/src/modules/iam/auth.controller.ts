import { Body, Controller, Get, Ip, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { IsEmail, IsIn, IsISO31661Alpha2, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { Public } from "./jwt-auth.guard";
import { CurrentUser } from "./roles.guard";
import { clearAuthCookies, readCookie, REFRESH_COOKIE, setAuthCookies } from "./auth-cookies";
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
  /** 浏览器端走 httpOnly cookie，可不传；脚本/服务端仍可显式传 */
  @IsOptional() @IsString() refreshToken?: string;
}

class ChangePasswordDto {
  @IsString() oldPassword!: string;
  @IsString() @MinLength(10) @MaxLength(128) newPassword!: string;
}

class ForgotPasswordDto {
  @IsEmail() email!: string;
}

class ResetPasswordDto {
  @IsString() token!: string;
  @IsString() @MinLength(10) @MaxLength(128) newPassword!: string;
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
  async login(@Body() dto: LoginDto, @Ip() ip: string, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(dto.email, dto.password, ip);
    setAuthCookies(res, tokens, this.auth.refreshTtlDays);
    return tokens;
  }

  @Public()
  @Post("refresh")
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = dto.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    if (!refreshToken) throw new UnauthorizedException({ code: "AUTH_TOKEN_EXPIRED", detail: "缺少刷新令牌" });
    const tokens = await this.auth.refresh(refreshToken);
    setAuthCookies(res, tokens, this.auth.refreshTtlDays);
    return tokens;
  }

  @Public()
  @Post("logout")
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = dto.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    if (refreshToken) await this.auth.logout(refreshToken);
    clearAuthCookies(res);
    return { ok: true };
  }

  @Post("change-password")
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.changePassword(user.sub, dto.oldPassword, dto.newPassword, ip);
    setAuthCookies(res, tokens, this.auth.refreshTtlDays);
    return tokens;
  }

  @Public()
  @Post("forgot-password")
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    await this.auth.forgotPassword(dto.email, ip);
    return { ok: true };
  }

  @Public()
  @Post("reset-password")
  async resetPassword(@Body() dto: ResetPasswordDto, @Ip() ip: string) {
    await this.auth.resetPassword(dto.token, dto.newPassword, ip);
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
