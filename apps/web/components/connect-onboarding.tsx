"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

interface ConnectStatus {
  onboarded: boolean;
  status: "NOT_STARTED" | "PENDING" | "PENDING_VERIFICATION" | "COMPLETED";
  requirementsDue: string[];
  stripeAccountId?: string;
}

/**
 * Stripe Connect 入驻卡片（R1-2）：供应商完成 KYC 后平台才能把托管货款打到其账户。
 * 未入驻时放款会被后端拦截（真实网关下）。
 */
export function ConnectOnboarding({ dict, locale }: { dict: Dictionary; locale: string }) {
  const t = dict.connect;
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<ConnectStatus>("GET", "/settlement/connect/status"));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const start = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const returnUrl = `${window.location.origin}/${locale}/supplier`;
      const res = await api<{ url: string }>("POST", "/settlement/connect/onboarding", { returnUrl, refreshUrl: returnUrl });
      // 假适配器返回站内回跳地址；真实 Stripe 返回 connect.stripe.com 托管页
      window.location.href = res.url;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
      setBusy(false);
    }
  };

  if (!status) return null;

  const label: Record<ConnectStatus["status"], string> = {
    NOT_STARTED: t.notStarted, PENDING: t.pending, PENDING_VERIFICATION: t.verifying, COMPLETED: t.completed,
  };

  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.title}</h2>
        <span
          className="badge"
          style={status.onboarded ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" } : undefined}
        >
          {label[status.status]}
        </span>
        {!status.onboarded && (
          <button className="btn btn-primary ml-auto" onClick={start} disabled={busy}>
            {busy ? dict.common.loading : status.status === "NOT_STARTED" ? t.start : t.continue}
          </button>
        )}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
        {status.onboarded ? t.doneHint : t.hint}
      </p>
      {status.requirementsDue.length > 0 && (
        <p className="text-xs" style={{ color: "var(--color-warning)" }}>
          ⚠ {t.requirements}: {status.requirementsDue.join(", ")}
        </p>
      )}
      {message && <p className="text-sm" style={{ color: "var(--color-warning)" }}>{message}</p>}
    </section>
  );
}
