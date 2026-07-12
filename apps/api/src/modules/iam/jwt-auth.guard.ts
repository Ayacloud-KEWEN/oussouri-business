import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ACCESS_COOKIE, readCookie } from "./auth-cookies";
import type { JwtPayload } from "./auth.types";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    // Bearer 头优先（脚本/服务端），浏览器端走 httpOnly cookie
    const token = header?.startsWith("Bearer ") ? header.slice(7) : readCookie(req, ACCESS_COOKIE);
    if (isPublic) {
      // 公共路由也尽力解析身份（可见性策略/差异化视图用），失败不拒绝
      if (token) {
        try {
          req.user = await this.jwt.verifyAsync<JwtPayload>(token);
        } catch {
          /* 匿名继续 */
        }
      }
      return true;
    }
    if (!token) throw new UnauthorizedException({ code: "AUTH_TOKEN_EXPIRED", detail: "缺少访问令牌" });
    try {
      req.user = await this.jwt.verifyAsync<JwtPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException({ code: "AUTH_TOKEN_EXPIRED", detail: "令牌无效或已过期" });
    }
  }
}
