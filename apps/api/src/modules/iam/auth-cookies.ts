import type { Request, Response } from "express";
import type { TokenPair } from "./auth.service";

export const ACCESS_COOKIE = "oussouri_at";
export const REFRESH_COOKIE = "oussouri_rt";

const isProd = () => process.env.NODE_ENV === "production";

/** 会话令牌写入 httpOnly cookie（浏览器端）；响应体仍返回令牌供脚本/服务端调用 */
export function setAuthCookies(res: Response, tokens: TokenPair, refreshTtlDays: number): void {
  const base = { httpOnly: true, secure: isProd(), sameSite: "lax" as const, path: "/" };
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: 15 * 60_000 });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: refreshTtlDays * 86_400_000 });
}

export function clearAuthCookies(res: Response): void {
  const base = { httpOnly: true, secure: isProd(), sameSite: "lax" as const, path: "/" };
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

/** 轻量 cookie 解析（避免 cookie-parser 依赖） */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
