"use client";

import { use, useCallback, useEffect, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

interface SupplierProduct { code: string; name: string; status: string; skuCount: number }
interface Lot { skuCode: string; lotNo: string; qtyOnHand: string; qtyReserved: string; expiresAt: string; status: string }
interface Order { code: string; status: string; counterpartyCode: string; grandTotal: string; commission?: string; currency: string }

export default function SupplierPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState({ name: "", categoryCode: "CAVIAR", speciesCode: "DAU", hsCode: "1604310000", originCountry: "CN" });
  const [newSku, setNewSku] = useState({ productCode: "", packSpec: "50g", netWeightKg: 0.05, unitPrice: 320 });
  const [inbound, setInbound] = useState({ skuCode: "", lotNo: "", qty: 100, producedAt: "2026-06-01", expiresAt: "2026-09-01" });

  const refresh = useCallback(async () => {
    const [p, l, o] = await Promise.all([
      api<SupplierProduct[]>("GET", "/supplier/products").catch(() => []),
      api<Lot[]>("GET", "/supplier/inventory/lots").catch(() => []),
      api<Order[]>("GET", "/supplier/orders").catch(() => []),
    ]);
    setProducts(p); setLots(l); setOrders(o);
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

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">{dict.supplier.title}</h1>
      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{dict.supplier.products}</h2>
        <div className="card space-y-2">
          {products.map((p) => (
            <div key={p.code} className="flex items-center gap-3 text-sm">
              <span className="font-mono">{p.code}</span>
              <span>{p.name}</span>
              <span className="badge">{p.status}</span>
              <span style={{ color: "var(--color-muted)" }}>SKU × {p.skuCount}</span>
              {p.status === "DRAFT" && p.skuCount > 0 && (
                <button className="btn btn-outline ml-auto" onClick={() => act(() => api("POST", `/supplier/products/${p.code}/submit`, {}))}>
                  {dict.supplier.submitReview}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <form
            className="card space-y-3"
            onSubmit={(e) => { e.preventDefault(); void act(() => api("POST", "/supplier/products", newProduct)); }}
          >
            <h3 className="text-sm font-medium">{dict.supplier.newProduct}</h3>
            <div>
              <label className="label">{dict.supplier.productName}</label>
              <input className="input" value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">{dict.supplier.category}</label>
                <input className="input" value={newProduct.categoryCode} onChange={(e) => setNewProduct({ ...newProduct, categoryCode: e.target.value })} />
              </div>
              <div>
                <label className="label">{dict.supplier.hsCode}</label>
                <input className="input" value={newProduct.hsCode} onChange={(e) => setNewProduct({ ...newProduct, hsCode: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit">{dict.supplier.create}</button>
          </form>
          <form
            className="card space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => api("POST", `/supplier/products/${newSku.productCode}/skus`, {
                packSpec: newSku.packSpec,
                netWeightKg: newSku.netWeightKg,
                unit: "TIN",
                moq: 1,
                priceTiers: [
                  { currency: "EUR", qtyMin: 0, qtyMax: 50, unitPrice: newSku.unitPrice },
                  { currency: "EUR", qtyMin: 50, unitPrice: Math.round(newSku.unitPrice * 0.94) },
                ],
              }));
            }}
          >
            <h3 className="text-sm font-medium">{dict.supplier.skuNew}</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">PRD</label>
                <input className="input" value={newSku.productCode} onChange={(e) => setNewSku({ ...newSku, productCode: e.target.value })} placeholder="PRD-000123" required />
              </div>
              <div>
                <label className="label">{dict.market.packSpec}</label>
                <input className="input" value={newSku.packSpec} onChange={(e) => setNewSku({ ...newSku, packSpec: e.target.value })} />
              </div>
              <div>
                <label className="label">{dict.supplier.netWeightKg}</label>
                <input className="input" type="number" step="0.01" value={newSku.netWeightKg} onChange={(e) => setNewSku({ ...newSku, netWeightKg: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">{dict.supplier.unitPrice}</label>
                <input className="input" type="number" value={newSku.unitPrice} onChange={(e) => setNewSku({ ...newSku, unitPrice: Number(e.target.value) })} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit">{dict.supplier.create}</button>
          </form>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{dict.supplier.inventory}</h2>
        <div className="card space-y-2">
          {lots.map((l) => (
            <div key={`${l.skuCode}-${l.lotNo}`} className="flex flex-wrap gap-3 text-sm">
              <span className="font-mono">{l.skuCode}</span>
              <span>{dict.supplier.lotNo}: {l.lotNo}</span>
              <span>{dict.supplier.onHand}: {l.qtyOnHand}</span>
              <span>{dict.supplier.reserved}: {l.qtyReserved}</span>
              <span style={{ color: "var(--color-muted)" }}>{dict.supplier.expires}: {l.expiresAt.slice(0, 10)}</span>
            </div>
          ))}
        </div>
        <form
          className="card grid gap-3 md:grid-cols-5"
          onSubmit={(e) => { e.preventDefault(); void act(() => api("POST", "/supplier/inventory/lots", inbound)); }}
        >
          <div className="md:col-span-2">
            <label className="label">SKU</label>
            <input className="input" value={inbound.skuCode} onChange={(e) => setInbound({ ...inbound, skuCode: e.target.value })} placeholder="PRD-000123-50G" required />
          </div>
          <div>
            <label className="label">{dict.supplier.lotNo}</label>
            <input className="input" value={inbound.lotNo} onChange={(e) => setInbound({ ...inbound, lotNo: e.target.value })} required />
          </div>
          <div>
            <label className="label">kg</label>
            <input className="input" type="number" value={inbound.qty} onChange={(e) => setInbound({ ...inbound, qty: Number(e.target.value) })} />
          </div>
          <div className="flex items-end">
            <button className="btn btn-primary w-full" type="submit">{dict.supplier.inbound}</button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{dict.supplier.orders}</h2>
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.code} className="card flex flex-wrap items-center gap-3 text-sm">
              <span className="font-mono">{o.code}</span>
              <span className="badge">{o.status}</span>
              <span style={{ color: "var(--color-muted)" }}>{dict.supplier.counterparty}: {o.counterpartyCode}</span>
              <span className="font-medium">€{o.grandTotal}</span>
              <div className="ml-auto flex gap-2">
                {o.status === "PAID_ESCROW" && (
                  <button className="btn btn-primary" onClick={() => act(() => api("POST", `/supplier/orders/${o.code}/confirm`, {}))}>{dict.supplier.confirm}</button>
                )}
                {o.status === "CONFIRMED" && (
                  <button className="btn btn-primary" onClick={() => act(() => api("POST", `/supplier/orders/${o.code}/ship`, {}))}>{dict.supplier.ship}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
