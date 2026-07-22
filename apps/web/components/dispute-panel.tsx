"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

export interface DisputeRow {
  id: string;
  orderCode?: string;
  orderStatus?: string;
  amount?: string;
  currency?: string;
  raisedBy: string;
  buyerCode?: string;
  supplierCode?: string;
  reasonCode: string;
  description: string;
  evidence?: unknown[];
  status: string;
  resolution?: { decision: string; refundAmount: string; supplierAmount: string; reason: string } | null;
  createdAt: string;
}

const REASONS = ["QUALITY_DEFECT", "QUANTITY_SHORT", "COLD_CHAIN_BREACH", "DOCUMENT_MISSING", "DELIVERY_DELAY", "OTHER"];

/** 字典对象按后端返回的代码取文案；未知代码回退显示原值 */
export const label = (dict: Record<string, string>, key: string): string => dict[key] ?? key;

/**
 * 订单页争议区（R1-6）：签收后争议期内可发起，平台冻结资金并居中裁决。
 * 这是托管模式的信任基石——没有可发起的争议，"钱在平台"对买家就不成立。
 */
export function DisputePanel({
  orderCode, orderStatus, disputeUntil, dict, onChanged,
}: {
  orderCode: string; orderStatus: string; disputeUntil: string | null; dict: Dictionary; onChanged: () => void;
}) {
  const t = dict.dispute;
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ reasonCode: "QUALITY_DEFECT", description: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const all = await api<DisputeRow[]>("GET", "/disputes").catch(() => []);
    setDisputes(all.filter((d) => d.orderCode === orderCode));
  }, [orderCode]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api("POST", "/disputes", { orderCode, reasonCode: form.reasonCode, description: form.description });
      setOpen(false);
      setForm({ reasonCode: "QUALITY_DEFECT", description: "" });
      await refresh();
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
    } finally {
      setBusy(false);
    }
  };

  const windowOpen = orderStatus === "DELIVERED" && (!disputeUntil || new Date(disputeUntil) > new Date());
  const active = disputes.find((d) => ["OPEN", "INVESTIGATING"].includes(d.status));
  if (disputes.length === 0 && !windowOpen) return null;

  return (
    <section className="card space-y-3" style={active ? { borderColor: "var(--color-warning)" } : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.title}</h2>
        {windowOpen && !active && (
          <button className="btn btn-outline text-xs" onClick={() => setOpen((v) => !v)}>
            {open ? dict.common.cancel ?? "×" : t.raise}
          </button>
        )}
      </div>

      {disputes.map((d) => (
        <div key={d.id} className="space-y-1 rounded-md p-2.5 text-sm" style={{ background: "var(--color-accent-soft)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge">{label(t.reasons, d.reasonCode)}</span>
            <span className="badge" style={d.status === "RESOLVED" ? undefined : { color: "var(--color-warning)" }}>{d.status}</span>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>{t.raisedBy} {d.raisedBy} · {d.createdAt.slice(0, 10)}</span>
          </div>
          <p className="text-xs leading-relaxed">{d.description}</p>
          {d.resolution && (
            <p className="border-t pt-1.5 text-xs" style={{ borderColor: "var(--color-border)" }}>
              <span style={{ color: "var(--color-accent)" }}>{t.verdict}: {label(t.decisions, d.resolution.decision)}</span>
              {Number(d.resolution.refundAmount) > 0 && ` · ${t.refund} ${d.currency} ${d.resolution.refundAmount}`}
              {d.resolution.reason && ` · ${d.resolution.reason}`}
            </p>
          )}
        </div>
      ))}

      {open && (
        <div className="space-y-2 border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
          <select className="input" value={form.reasonCode} onChange={(e) => setForm({ ...form, reasonCode: e.target.value })}>
            {REASONS.map((r) => <option key={r} value={r}>{label(t.reasons, r)}</option>)}
          </select>
          <textarea
            className="input h-24 w-full text-sm"
            placeholder={t.descriptionPlaceholder}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <button className="btn btn-primary" disabled={busy || form.description.trim().length < 10} onClick={() => void submit()}>
              {busy ? dict.common.loading : t.submit}
            </button>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>{t.freezeNote}</span>
          </div>
        </div>
      )}

      {windowOpen && !active && !open && (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          {t.windowNote}{disputeUntil ? ` ${disputeUntil.slice(0, 16).replace("T", " ")}` : ""}
        </p>
      )}
      {message && <p className="text-sm" style={{ color: "var(--color-warning)" }}>{message}</p>}
    </section>
  );
}
