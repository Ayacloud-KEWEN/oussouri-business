"use client";

import { use, useCallback, useEffect, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

interface Opportunity {
  code: string;
  status: string;
  signal: string;
  buyerCode?: string;
  buyerCountry?: string;
  supplierCode?: string;
  product: { name?: string; skuCode?: string } | null;
  scores: { matching: string; opportunity: string; urgency: string; profit: string };
  explanation: Record<string, unknown>;
  assignedToMe: boolean;
}

export default function BrokerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  const t = dict.broker;
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [orderForm, setOrderForm] = useState<{ opportunityCode: string; buyerOrgCode: string; skuCode: string; qty: number; unitPriceEur: number } | null>(null);
  const [calls, setCalls] = useState<{ callId: string; targetOrgCode?: string; startedAt?: string; durationSec?: number; outcome: string }[]>([]);

  const refresh = useCallback(async () => {
    setOpps(await api<Opportunity[]>("GET", "/broker/opportunities").catch(() => []));
    setCalls(await api<typeof calls>("GET", "/broker/calls").catch(() => []));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>, successMsg?: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage(successMsg ?? dict.common.success);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
    }
  };

  const signalLabel = (s: string) => (t.signals as Record<string, string>)[s] ?? s;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <button className="btn btn-outline ml-auto" onClick={() => act(() => api("POST", "/broker/matchmaking/run", {}))}>
          {t.runMatchmaking}
        </button>
      </div>
      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.opportunities}</h2>
        {opps.length === 0 && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.empty}</p>}
        {opps.map((o) => (
          <div key={o.code} className="card space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-mono">{o.code}</span>
              <span className="badge">{o.status}</span>
              <span style={{ color: "var(--color-muted)" }}>{t.signal}: {signalLabel(o.signal)}</span>
              {o.assignedToMe && <span className="badge">{t.claimed}</span>}
              <span className="ml-auto flex gap-2 text-xs">
                {(["matching", "opportunity", "urgency", "profit"] as const).map((k) => (
                  <span key={k} className="rounded px-1.5 py-0.5" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
                    {t.scores[k]} {Number(o.scores[k]).toFixed(0)}
                  </span>
                ))}
              </span>
            </div>
            <p className="text-sm">
              <span className="font-mono">{o.buyerCode}</span> ({o.buyerCountry}) ↔ <span className="font-mono">{o.supplierCode}</span>
              {o.product?.name && <> · {o.product.name} <span style={{ color: "var(--color-muted)" }}>[{o.product.skuCode}]</span></>}
            </p>
            <div className="flex flex-wrap gap-2 text-sm">
              {!o.assignedToMe && (
                <button className="btn btn-outline" onClick={() => act(() => api("POST", `/broker/opportunities/${o.code}/claim`, {}))}>{t.claim}</button>
              )}
              {o.assignedToMe && (
                <button
                  className="btn btn-outline"
                  onClick={() => act(() => api("POST", "/broker/calls", { targetOrgCode: o.buyerCode, opportunityCode: o.code }), t.callStarted)}
                >
                  {t.call}
                </button>
              )}
              {o.status === "NEW" && o.assignedToMe && (
                <button className="btn btn-outline" onClick={() => act(() => api("POST", `/broker/opportunities/${o.code}/transition`, { toState: "CONTACTED" }))}>
                  {t.markContacted}
                </button>
              )}
              {o.assignedToMe && (
                <button
                  className="btn btn-primary"
                  onClick={() => setOrderForm({ opportunityCode: o.code, buyerOrgCode: o.buyerCode ?? "", skuCode: o.product?.skuCode ?? "", qty: 20, unitPriceEur: 300 })}
                >
                  {t.createOrder}
                </button>
              )}
              {o.assignedToMe && o.status !== "WON" && (
                <button className="btn btn-outline" onClick={() => act(() => api("POST", `/broker/opportunities/${o.code}/transition`, { toState: "LOST", reason: "closed by broker" }))}>
                  {t.markLost}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      {calls.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.calls}</h2>
          <div className="card space-y-1.5 text-xs">
            {calls.map((c) => (
              <div key={c.callId} className="flex flex-wrap gap-3">
                <span className="font-mono">{c.targetOrgCode}</span>
                <span style={{ color: "var(--color-muted)" }}>{c.startedAt?.slice(0, 16).replace("T", " ")}</span>
                <span className="badge">{c.outcome}</span>
                {c.durationSec != null && <span style={{ color: "var(--color-muted)" }}>{c.durationSec}s</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {orderForm && (
        <section className="card space-y-3">
          <h2 className="font-medium">{t.createOrder} · <span className="font-mono text-sm">{orderForm.opportunityCode}</span></h2>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="label">{t.buyerCode}</label>
              <input className="input" value={orderForm.buyerOrgCode} onChange={(e) => setOrderForm({ ...orderForm, buyerOrgCode: e.target.value })} />
            </div>
            <div>
              <label className="label">SKU</label>
              <input className="input" value={orderForm.skuCode} onChange={(e) => setOrderForm({ ...orderForm, skuCode: e.target.value })} />
            </div>
            <div>
              <label className="label">{dict.rfq.qty}</label>
              <input className="input" type="number" value={orderForm.qty} onChange={(e) => setOrderForm({ ...orderForm, qty: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">{t.unitPrice}</label>
              <input className="input" type="number" value={orderForm.unitPriceEur} onChange={(e) => setOrderForm({ ...orderForm, unitPriceEur: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => act(async () => { await api("POST", "/broker/orders", orderForm); setOrderForm(null); }, t.orderCreated)}
            >
              {dict.auth.submit}
            </button>
            <button className="btn btn-outline" onClick={() => setOrderForm(null)}>×</button>
          </div>
        </section>
      )}
    </div>
  );
}
