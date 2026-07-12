import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { VisibilityService } from "./visibility.service";
import type { JwtPayload } from "../../modules/iam/auth.types";

export const VISIBILITY_RESOURCE_KEY = "visibilityResource";
/** 标注响应资源类型，启用 VisibilityPolicy 表驱动过滤 */
export const VisibilityResource = (resource: string) => SetMetadata(VISIBILITY_RESOURCE_KEY, resource);

@Injectable()
export class VisibilityInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly visibility: VisibilityService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const resource = this.reflector.getAllAndOverride<string>(VISIBILITY_RESOURCE_KEY, [context.getHandler(), context.getClass()]);
    if (!resource) return next.handle();
    const user: JwtPayload | undefined = context.switchToHttp().getRequest().user;
    return next.handle().pipe(mergeMap((payload) => this.visibility.apply(resource, payload, user?.roles ?? [])));
  }
}
