import { cookies } from "next/headers";

/** SSR 直连 NestJS（服务器组件用，不经浏览器代理）；转发用户 cookie 以保留登录身份（批发价可见性等） */
const API_URL = process.env.API_URL ?? "http://localhost:3001";

export async function serverApi<T = unknown>(path: string): Promise<T | null> {
  try {
    let cookieHeader = "";
    try {
      const store = await cookies();
      cookieHeader = store
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
    } catch {
      // 无请求上下文（构建期/静态渲染）时匿名访问
    }
    const res = await fetch(`${API_URL}/v1${path}`, {
      cache: "no-store",
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
