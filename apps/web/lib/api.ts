"use client";

/**
 * 浏览器端 API 客户端。
 * P1 开发版：accessToken 存 localStorage；生产升级为 httpOnly cookie + 刷新旋转（Step 5 §1.2）。
 */
const TOKEN_KEY = "oussouri.accessToken";
const SESSION_KEY = "oussouri.session";

export interface SessionInfo {
  roles: string[];
  orgCode?: string;
  partyType?: string;
  displayName?: string;
}

export function getToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

export function getSession(): SessionInfo | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as SessionInfo) : null;
}

export function setSession(token: string, info: SessionInfo): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(info));
  window.dispatchEvent(new Event("oussouri:session"));
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY);
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

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new ApiError(res.status, String(json?.code ?? "INTERNAL"), String(json?.detail ?? json?.message ?? res.statusText));
  }
  return json as T;
}
