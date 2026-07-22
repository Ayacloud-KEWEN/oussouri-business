"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { api } from "@/lib/api";
import { label, type DisputeRow } from "./dispute-panel";

/** 管理后台争议裁决（R1-6）：驳回放款 / 全额退款 / 部分退款 */
export function AdminDisputes({ dict }: { dict: Dictionary }) {
  const t = dict.dispute;
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { decision: string; refundAmount: string; reason: string }>>({});

  const refresh = useCallback(async () => {
    setRows(await api<DisputeRow[]>("GET", "/disputes").catch(() => []));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const resolve = async (d: DisputeRow) => {
    const input = draft[d.id] ?? { decision: "REJECT", refundAmount: "", reason: "" };
    setMessage(null);
    try {
      await api("POST", `/disputes/${d.id}/resolve`, {
        decision: input.decision,
        refundAmount: input.decision === "REFUND_PARTIAL" ? Number(input.refundAmount) : undefined,
        reason: input.reason,
      });
      await refresh();
      setMessage(dict.common.success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
    }
  };

  const pending = rows.filter((d) => ["OPEN", "INVESTIGATING"].includes(d.status));
  const closed = rows.filter((d) => d.status === "RESOLVED");

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.adminTitle}</h2>
        <span className="text-xs" style={{ color: "var(--color-muted)" }}>{t.adminHint}</span>
      </div>
      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      {pending.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.noPending}</p>
      ) : (
        pending.map((d) => {
          const input = draft[d.id] ?? { decision: "REJECT", refundAmount: "", reason: "" };
          return (
            <div key={d.id} className="card space-y-2 text-sm" style={{ borderColor: "var(--color-warning)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{d.orderCode}</span>
                <span className="badge">{label(t.reasons, d.reasonCode)}</span>
                <span className="badge">{d.status}</span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {t.raisedBy} {d.raisedBy} · {d.buyerCode} ↔ {d.supplierCode}
                </span>
                <span className="ml-auto font-medium">{d.currency} {d.amount}</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>{d.description}</p>
              <div className="grid gap-2 sm:grid-cols-4">
                <select
                  className="input"
                  value={input.decision}
                  onChange={(e) => setDraft({ ...draft, [d.id]: { ...input, decision: e.target.value } })}
                >
                  <option value="REJECT">{t.decisions.REJECT}</option>
                  <option value="REFUND_FULL">{t.decisions.REFUND_FULL}</option>
                  <option value="REFUND_PARTIAL">{t.decisions.REFUND_PARTIAL}</option>
                </select>
                {input.decision === "REFUND_PARTIAL" && (
                  <input
                    className="input" type="number" step="0.01" placeholder={t.refundAmount}
                    value={input.refundAmount}
                    onChange={(e) => setDraft({ ...draft, [d.id]: { ...input, refundAmount: e.target.value } })}
                  />
                )}
                <input
                  className="input sm:col-span-2" placeholder={t.verdictReason}
                  value={input.reason}
                  onChange={(e) => setDraft({ ...draft, [d.id]: { ...input, reason: e.target.value } })}
                />
              </div>
              <button className="btn btn-primary" disabled={input.reason.trim().length < 5} onClick={() => void resolve(d)}>
                {t.submitVerdict}
              </button>
            </div>
          );
        })
      )}

      {closed.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium">{t.resolvedHistory}（{closed.length}）</summary>
          <div className="mt-2 space-y-1.5 text-xs">
            {closed.map((d) => (
              <div key={d.id} className="flex flex-wrap gap-2 border-t pt-1.5" style={{ borderColor: "var(--color-border)" }}>
                <span className="font-mono">{d.orderCode}</span>
                <span>{label(t.reasons, d.reasonCode)}</span>
                {d.resolution && (
                  <span style={{ color: "var(--color-accent)" }}>
                    {label(t.decisions, d.resolution.decision)}
                    {Number(d.resolution.refundAmount) > 0 && ` · ${t.refund} ${d.resolution.refundAmount}`}
                  </span>
                )}
                <span style={{ color: "var(--color-muted)" }}>{d.createdAt.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
