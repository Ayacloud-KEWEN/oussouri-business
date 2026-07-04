"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { api, getSession } from "@/lib/api";

interface Tier { currency: string; qtyMin: string; qtyMax: string | null; unitPrice: string }
interface Sku { skuCode: string; packSpec: string; moq: string; unit: string; priceTiers: Tier[] | "LOGIN_REQUIRED" }
interface ProductDetail { code: string; skus: Sku[] }

/** 登录后展示阶梯价并可加购；未登录引导注册（BR-01-01 获客漏斗） */
export function ProductActions({ locale, code, dict }: { locale: string; code: string; dict: Dictionary }) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [qty, setQty] = useState(50);
  const [message, setMessage] = useState<string | null>(null);
  const session = typeof window !== "undefined" ? getSession() : null;
  const isBuyer = session?.roles?.includes("BUYER") ?? false;

  useEffect(() => {
    api<ProductDetail>("GET", `/products/${code}`).then(setProduct).catch(() => setProduct(null));
  }, [code]);

  const sku = product?.skus?.[0];
  const tiers = sku && Array.isArray(sku.priceTiers) ? sku.priceTiers : null;

  const addToCart = async () => {
    if (!sku) return;
    setMessage(null);
    try {
      await api("POST", "/buyer/cart/items", { skuCode: sku.skuCode, qty });
      setMessage(dict.common.success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
    }
  };

  return (
    <div className="space-y-4">
      {sku && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          {dict.market.packSpec}: {sku.packSpec} · {dict.market.moq}: {sku.moq} {sku.unit}
        </p>
      )}
      {tiers ? (
        <div className="card space-y-2">
          <h2 className="text-sm font-medium">{dict.market.priceTiers}</h2>
          <table className="w-full text-sm">
            <tbody>
              {tiers.map((t, i) => (
                <tr key={i} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="py-1.5" style={{ color: "var(--color-muted)" }}>
                    {t.qtyMin} – {t.qtyMax ?? "∞"} kg
                  </td>
                  <td className="py-1.5 text-right font-medium">€{t.unitPrice}/kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Link href={`/${locale}/login`} className="btn btn-outline">{dict.market.loginForPrice}</Link>
      )}
      {isBuyer && tiers && (
        <div className="flex items-end gap-3">
          <div>
            <label className="label">{dict.market.qty} (kg)</label>
            <input
              className="input w-28"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </div>
          <button className="btn btn-primary" onClick={addToCart}>{dict.market.addToCart}</button>
          {message && <span className="pb-2 text-sm" style={{ color: "var(--color-muted)" }}>{message}</span>}
        </div>
      )}
    </div>
  );
}
