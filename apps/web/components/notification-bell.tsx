"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { interpolate } from "@/lib/i18n";
import { api, getSession } from "@/lib/api";

interface NotificationItem {
  id: string;
  templateCode: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
  readAt: string | null;
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  // 开发环境 Next 重写不代理 WS，直连 API；生产走 Nginx /api/v1（Upgrade 头已配）
  if (window.location.port === "3000") return `${proto}://localhost:3001/v1/ws`;
  return `${proto}://${window.location.host}/api/v1/ws`;
}

export function NotificationBell({ dict }: { dict: Dictionary }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const load = useCallback(() => {
    api<NotificationItem[]>("GET", "/notifications")
      .then(setItems)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const sync = () => setLoggedIn(Boolean(getSession()));
    sync();
    window.addEventListener("oussouri:session", sync);
    return () => window.removeEventListener("oussouri:session", sync);
  }, []);

  useEffect(() => {
    if (!loggedIn) {
      setItems([]);
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }
    load();
    let closed = false;
    let retry = 0;
    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data as string);
          if (event.type === "notification") {
            setItems((prev) => [
              { id: event.id, templateCode: event.templateCode, payload: event.payload ?? {}, status: "PENDING", createdAt: event.createdAt, readAt: null },
              ...prev,
            ]);
          }
        } catch {
          /* 忽略非 JSON 帧 */
        }
      };
      ws.onopen = () => {
        retry = 0;
      };
      ws.onclose = () => {
        if (!closed && retry < 5) {
          retry += 1;
          setTimeout(connect, Math.min(30_000, 2 ** retry * 1000));
        }
      };
    };
    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [loggedIn, load]);

  if (!loggedIn) return null;

  const unread = items.filter((n) => n.status !== "READ").length;

  const label = (n: NotificationItem): string => {
    const templates = dict.notifications.templates as Record<string, string>;
    const template = templates[n.templateCode];
    if (!template) return n.templateCode;
    return interpolate(template, Object.fromEntries(Object.entries(n.payload).map(([k, v]) => [k, String(v)])));
  };

  const markRead = async (n: NotificationItem) => {
    if (n.status === "READ") return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, status: "READ" } : x)));
    await api("POST", `/notifications/${n.id}/read`, {}).catch(() => undefined);
  };

  return (
    <span className="relative inline-block">
      <button
        className="relative cursor-pointer rounded-md border px-2 py-1"
        style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
        aria-label={dict.notifications.title}
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unread > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 rounded-full px-1.5 text-xs text-white"
            style={{ background: "var(--color-destructive)" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-md border shadow-lg"
          style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
        >
          <p className="border-b px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--color-border)" }}>
            {dict.notifications.title}
          </p>
          {items.length === 0 && <p className="px-3 py-4 text-sm opacity-70">{dict.notifications.empty}</p>}
          {items.map((n) => (
            <button
              key={n.id}
              className="block w-full cursor-pointer border-b px-3 py-2 text-left text-sm hover:opacity-80"
              style={{ borderColor: "var(--color-border)", opacity: n.status === "READ" ? 0.6 : 1 }}
              onClick={() => void markRead(n)}
            >
              <span className="block">{label(n)}</span>
              <span className="block text-xs opacity-60">{new Date(n.createdAt).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
