"use client";

import { use, useCallback, useEffect, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

interface CartItem { skuCode: string; packSpec: string; qty: string }
interface RfqQuote { id: string; supplierCode?: string; unitPrice: string; leadTimeDays?: number; validUntil: string; status: string }
interface RfqRow { code: string; categoryCode: string; speciesCode?: string; qty: string; targetPrice?: string; deadline: string; status: string; quotes: RfqQuote[] }
interface OrderItem { qty: string; unitPrice: string; lineTotal: string; snapshot: { productName: string; skuCode: string } }
interface Order { code: string; status: string; counterpartyCode: string; currency: string; grandTotal: string; items: OrderItem[] }

export default function BuyerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [rfqs, setRfqs] = useState<RfqRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [rfqForm, setRfqForm] = useState({ categoryCode: "CAVIAR", speciesCode: "", qty: 50, targetPrice: 300, destCountry: "FR", deadline: "" });

  const refresh = useCallback(async () => {
    const [c, o, r] = await Promise.all([
      api<CartItem[]>("GET", "/buyer/cart").catch(() => []),
      api<Order[]>("GET", "/buyer/orders").catch(() => []),
      api<RfqRow[]>("GET", "/buyer/rfqs").catch(() => []),
    ]);
    setCart(c);
    setOrders(o);
    setRfqs(r);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await fn();
      setMessage(dict.common.success);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
    }
  };

  const placeOrder = () =>
    act(() => api("POST", "/buyer/orders", { items: cart.map((i) => ({ skuCode: i.skuCode, qty: Number(i.qty) })), currency: "EUR" }));

  const pay = (orderCode: string) =>
    act(async () => {
      const checkout = await api<{ intentId: string }>("POST", "/payments/checkout", { orderCode });
      // 开发环境假 Stripe：直接回调 webhook 模拟支付成功
      await api("POST", "/webhooks/stripe", { type: "payment_intent.succeeded", data: { object: { id: checkout.intentId } } });
    });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{dict.buyer.title}</h1>
      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{dict.buyer.cart}</h2>
        {cart.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>{dict.buyer.empty}</p>
        ) : (
          <div className="card space-y-3">
            {cart.map((i) => (
              <div key={i.skuCode} className="flex justify-between text-sm">
                <span>{i.skuCode} · {i.packSpec}</span>
                <span>{i.qty} kg</span>
              </div>
            ))}
            <button className="btn btn-primary" onClick={placeOrder}>{dict.buyer.placeOrder}</button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{dict.rfq.title}</h2>
        <form
          className="card grid gap-3 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api("POST", "/buyer/rfqs", { ...rfqForm, speciesCode: rfqForm.speciesCode || undefined, deadline: rfqForm.deadline || new Date(Date.now() + 14 * 86400000).toISOString() }));
          }}
        >
          <div>
            <label className="label">{dict.rfq.category}</label>
            <input className="input" value={rfqForm.categoryCode} onChange={(e) => setRfqForm({ ...rfqForm, categoryCode: e.target.value })} />
          </div>
          <div>
            <label className="label">{dict.rfq.species}</label>
            <input className="input" value={rfqForm.speciesCode} onChange={(e) => setRfqForm({ ...rfqForm, speciesCode: e.target.value })} placeholder="SCHDAU" />
          </div>
          <div>
            <label className="label">{dict.rfq.qty}</label>
            <input className="input" type="number" value={rfqForm.qty} onChange={(e) => setRfqForm({ ...rfqForm, qty: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">{dict.rfq.targetPrice}</label>
            <input className="input" type="number" value={rfqForm.targetPrice} onChange={(e) => setRfqForm({ ...rfqForm, targetPrice: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">{dict.rfq.destCountry}</label>
            <input className="input" value={rfqForm.destCountry} onChange={(e) => setRfqForm({ ...rfqForm, destCountry: e.target.value.toUpperCase() })} maxLength={2} />
          </div>
          <div className="flex items-end">
            <button className="btn btn-primary w-full" type="submit">{dict.rfq.publish}</button>
          </div>
        </form>
        <div className="space-y-3">
          {rfqs.map((r) => (
            <div key={r.code} className="card space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono">{r.code}</span>
                <span className="badge">{r.status}</span>
                <span>{r.categoryCode}{r.speciesCode ? ` · ${r.speciesCode}` : ""} · {r.qty} kg</span>
                <span style={{ color: "var(--color-muted)" }}>{dict.rfq.deadline}: {r.deadline.slice(0, 10)}</span>
              </div>
              {r.quotes.length > 0 && (
                <div className="space-y-1.5 border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
                  {r.quotes.map((q) => (
                    <div key={q.id} className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-mono">{q.supplierCode}</span>
                      <span className="font-medium">€{q.unitPrice}/kg</span>
                      {q.leadTimeDays != null && <span style={{ color: "var(--color-muted)" }}>{dict.rfq.leadTime}: {q.leadTimeDays}</span>}
                      <span className="badge">{q.status}</span>
                      {q.status === "SUBMITTED" && r.status !== "ACCEPTED" && (
                        <button className="btn btn-primary ml-auto" onClick={() => act(() => api("POST", `/buyer/quotes/${q.id}/accept`, {}))}>
                          {dict.rfq.accept}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{dict.buyer.orders}</h2>
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.code} className="card space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm">{o.code}</span>
                <span className="badge">{o.status}</span>
                <span className="text-sm" style={{ color: "var(--color-muted)" }}>{dict.buyer.counterparty}: {o.counterpartyCode}</span>
                <span className="ml-auto font-medium">€{o.grandTotal}</span>
              </div>
              <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                {o.items.map((i, idx) => (
                  <div key={idx}>{i.snapshot.productName} × {i.qty} @ €{i.unitPrice}</div>
                ))}
              </div>
              <div className="flex gap-2">
                {o.status === "PLACED" && (
                  <>
                    <button className="btn btn-primary" onClick={() => pay(o.code)}>{dict.buyer.pay}</button>
                    <button className="btn btn-outline" onClick={() => act(() => api("POST", `/buyer/orders/${o.code}/cancel`, {}))}>{dict.buyer.cancel}</button>
                  </>
                )}
                {o.status === "SHIPPED" && (
                  <button className="btn btn-primary" onClick={() => act(() => api("POST", `/buyer/orders/${o.code}/confirm-delivery`, {}))}>
                    {dict.buyer.confirmDelivery}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
