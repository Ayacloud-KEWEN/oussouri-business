"use client";

/**
 * 浏览器端 API 客户端。
 * 令牌在 httpOnly cookie（oussouri_at / oussouri_rt）中由 API 下发，前端不可读；
 * localStorage 只存非敏感的会话展示信息（角色/平台代码）。
 * 401 时自动尝试一次 cookie 刷新后重放请求。
 */
const SESSION_KEY = "oussouri.session";
const LEGACY_TOKEN_KEY = "oussouri.accessToken";

export interface SessionInfo {
  roles: string[];
  orgCode?: string;
  partyType?: string;
  displayName?: string;
}

export function getSession(): SessionInfo | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as SessionInfo) : null;
}

export function setSession(info: SessionInfo): void {
  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(info));
  window.dispatchEvent(new Event("oussouri:session"));
}

export function clearSession(): void {
  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  window.localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("oussouri:session"));
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

async function rawFetch(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// 刷新单飞：并发 401 共享同一次 /auth/refresh，避免旋转令牌互相吊销
let refreshInFlight: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= rawFetch("POST", "/auth/refresh", {})
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await rawFetch(method, path, body);
  // 访问令牌过期：用 refresh cookie 换新后重放一次（刷新接口本身除外）
  if (res.status === 401 && path !== "/auth/refresh" && path !== "/auth/login") {
    if (await refreshOnce()) {
      res = await rawFetch(method, path, body);
    } else if (getSession()) {
      clearSession();
    }
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new ApiError(res.status, String(json?.code ?? "INTERNAL"), String(json?.detail ?? json?.message ?? res.statusText));
  }
  return json as T;
}
