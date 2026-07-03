import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { JwtPayload } from "./auth.types";

export const ROLES_KEY = "roles";
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtPayload => {
  return ctx.switchToHttp().getRequest().user as JwtPayload;
});

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest().user as JwtPayload | undefined;
    if (!user) return false;
    if (user.roles.includes("SUPER_ADMIN")) return true;
    if (!required.some((r) => user.roles.includes(r))) {
      throw new ForbiddenException({ code: "PERM_DENIED", detail: "无权访问该资源" });
    }
    return true;
  }
}
