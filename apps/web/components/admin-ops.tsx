"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { interpolate } from "@/lib/i18n";
import { api } from "@/lib/api";

interface CommissionRule {
  id: string;
  categoryCode: string | null;
  ratePct: string;
  priority: number;
  effectiveFrom: string;
}

interface RiskData {
  sinceDays: number;
  total: number;
  byRule: { rule: string; count: number }[];
  topUsers: { displayName: string; count: number }[];
  recent: { id: string; displayName: string; matchedRule: string; excerpt: string; occurredAt: string }[];
}

interface AuditRow {
  id: string;
  actor: string;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  reason: string | null;
  occurredAt: string;
}

/** 管理后台运营面板：佣金规则 / PII 拦截看板 / 审计检索（R2 补齐） */
export function AdminOps({ dict }: { dict: Dictionary }) {
  const t = dict.admin;
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [newRate, setNewRate] = useState("0.08");
  const [risk, setRisk] = useState<RiskData | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditAction, setAuditAction] = useState("");
  const [auditTargetType, setAuditTargetType] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const loadRules = useCallback(() => api<CommissionRule[]>("GET", "/admin/commission-rules").then(setRules).catch(() => undefined), []);
  const loadRisk = useCallback(() => api<RiskData>("GET", "/admin/risk/blocks?days=30").then(setRisk).catch(() => undefined), []);
  const loadAudit = useCallback(
    (action: string, targetType: string) =>
      api<{ data: AuditRow[] }>(
        "GET",
        `/admin/audit?pageSize=30${action ? `&action=${encodeURIComponent(action)}` : ""}${targetType ? `&targetType=${encodeURIComponent(targetType)}` : ""}`,
      )
        .then((r) => setAuditRows(r.data))
        .catch(() => undefined),
    [],
  );

  useEffect(() => {
    void loadRules();
    void loadRisk();
    void loadAudit("", "");
  }, [loadRules, loadRisk, loadAudit]);

  const addRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await api("POST", "/admin/commission-rules", {
        categoryCode: newCategory.trim() || undefined,
        ratePct: Number(newRate),
        priority: newCategory.trim() ? 10 : 0,
      });
      setNewCategory("");
      await loadRules();
      setMessage(dict.common.success);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : dict.common.error);
    }
  };

  const deleteRule = async (id: string) => {
    await api("DELETE", `/admin/commission-rules/${id}`).catch(() => undefined);
    await loadRules();
  };

  return (
    <>
      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      {/* ===== 佣金规则 ===== */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.commission}</h2>
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>{t.commissionNote}</span>
        </div>
        <form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={addRule}>
          <div>
            <label className="label">{t.category}</label>
            <input className="input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="CAVIAR" />
          </div>
          <div>
            <label className="label">{t.ratePct}</label>
            <input className="input w-32" type="number" step="0.001" min="0" max="0.5" value={newRate} onChange={(e) => setNewRate(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit">{t.addRule}</button>
        </form>
        {rules.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.empty}</p>
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="card flex flex-wrap items-center gap-3 text-sm">
                <span className="badge">{r.categoryCode ?? t.allCategories}</span>
                <span className="font-medium">{(Number(r.ratePct) * 100).toFixed(2)}%</span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {t.priority} {r.priority} · {r.effectiveFrom.slice(0, 10)}
                </span>
                <button className="btn btn-outline ml-auto" onClick={() => void deleteRule(r.id)}>
                  {t.deleteRule}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== PII 拦截风控看板 ===== */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.risk}</h2>
          {risk && <span className="text-xs" style={{ color: "var(--color-muted)" }}>{interpolate(t.riskNote, { days: String(risk.sinceDays) })}</span>}
        </div>
        {risk && (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="card space-y-1 text-sm">
              <p className="text-2xl font-semibold">{risk.total}</p>
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>{interpolate(t.blocksTotal, { total: String(risk.total) })}</p>
            </div>
            <div className="card space-y-1 text-sm">
              <p className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>{t.byRule}</p>
              {risk.byRule.length === 0 ? <p className="text-xs">—</p> : risk.byRule.map((r) => (
                <p key={r.rule} className="flex justify-between text-xs"><span>{r.rule}</span><span>{r.count}</span></p>
              ))}
            </div>
            <div className="card space-y-1 text-sm">
              <p className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>{t.topUsers}</p>
              {risk.topUsers.length === 0 ? <p className="text-xs">—</p> : risk.topUsers.slice(0, 5).map((u) => (
                <p key={u.displayName} className="flex justify-between text-xs"><span>{u.displayName}</span><span>{u.count}</span></p>
              ))}
            </div>
          </div>
        )}
        {risk && risk.recent.length > 0 && (
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs font-medium" style={{ color: "var(--color-muted)" }}>{t.recentBlocks}</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>
                  <th className="py-1 pr-4">{t.time}</th>
                  <th className="py-1 pr-4">{t.user}</th>
                  <th className="py-1 pr-4">{dict.common.status}</th>
                  <th className="py-1 pr-4">{t.excerpt}</th>
                </tr>
              </thead>
              <tbody>
                {risk.recent.slice(0, 10).map((e) => (
                  <tr key={e.id} className="border-b" style={{ borderColor: "var(--color-border)" }}>
                    <td className="py-1 pr-4 whitespace-nowrap">{new Date(e.occurredAt).toLocaleString()}</td>
                    <td className="py-1 pr-4">{e.displayName}</td>
                    <td className="py-1 pr-4">{e.matchedRule}</td>
                    <td className="py-1 pr-4" style={{ color: "var(--color-muted)" }}>{e.excerpt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ===== 审计检索 ===== */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.audit}</h2>
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>{t.auditNoteSearch}</span>
        </div>
        <form
          className="flex flex-wrap items-end gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void loadAudit(auditAction, auditTargetType);
          }}
        >
          <div>
            <label className="label">{t.actionFilter}</label>
            <input className="input" value={auditAction} onChange={(e) => setAuditAction(e.target.value)} placeholder="LOGIN" />
          </div>
          <div>
            <label className="label">{t.targetTypeFilter}</label>
            <input className="input" value={auditTargetType} onChange={(e) => setAuditTargetType(e.target.value)} placeholder="Organization" />
          </div>
          <button className="btn btn-primary" type="submit">{t.searchBtn}</button>
        </form>
        {auditRows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>
                  <th className="py-1 pr-4">{t.time}</th>
                  <th className="py-1 pr-4">{t.actor}</th>
                  <th className="py-1 pr-4">{t.action}</th>
                  <th className="py-1 pr-4">{t.target}</th>
                  <th className="py-1 pr-4">{t.reason}</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((r) => (
                  <tr key={r.id} className="border-b" style={{ borderColor: "var(--color-border)" }}>
                    <td className="py-1 pr-4 whitespace-nowrap">{new Date(r.occurredAt).toLocaleString()}</td>
                    <td className="py-1 pr-4">{r.actor}</td>
                    <td className="py-1 pr-4 font-mono">{r.action}</td>
                    <td className="py-1 pr-4">{r.targetType ?? "—"}</td>
                    <td className="py-1 pr-4" style={{ color: "var(--color-muted)" }}>{r.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
