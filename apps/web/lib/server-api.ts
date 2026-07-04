/** SSR 直连 NestJS（服务器组件用，不经浏览器代理） */
const API_URL = process.env.API_URL ?? "http://localhost:3001";

export async function serverApi<T = unknown>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/v1${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
