"use client";

import { use, useCallback, useEffect, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

interface PendingParty {
  publicCode: string;
  partyType: string;
  countryIso2: string;
  companyName: string;
  registrationNo: string | null;
  taxId: string | null;
  contactName: string | null;
  certificates: { certType: string; certNo: string; expiryDate: string | null; status: string }[];
  submittedAt: string;
}

interface PendingProduct {
  code: string;
  name: string;
  description: string | null;
  categoryCode: string;
  speciesCode: string | null;
  gradeCode: string | null;
  hsCode: string;
  supplierCode?: string;
  image: string | null;
  skus: { skuCode: string; packSpec: string; moq: string; priceTiers: { currency: string; qtyMin: string; qtyMax: string | null; unitPrice: string }[] }[];
}

export default function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  const t = dict.admin;
  const [pending, setPending] = useState<PendingParty[]>([]);
  const [pendingProducts, setPendingProducts] = useState<PendingProduct[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [parties, products] = await Promise.all([
      api<{ data: PendingParty[] }>("GET", "/admin/parties?page=1&pageSize=50").catch(() => ({ data: [] })),
      api<PendingProduct[]>("GET", "/admin/products/pending").catch(() => []),
    ]);
    setPending(parties.data);
    setPendingProducts(products);
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
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      {/* ===== 入驻审核（含真实详情，读取已留审计） ===== */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.pendingParties}</h2>
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>{t.auditNote}</span>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.empty}</p>
        ) : (
          <div className="space-y-3">
            {pending.map((p) => (
              <div key={p.publicCode} className="card space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono">{p.publicCode}</span>
                  <span className="badge">{p.partyType}</span>
                  <span style={{ color: "var(--color-muted)" }}>{p.countryIso2} · {p.submittedAt.slice(0, 10)}</span>
                  <div className="ml-auto flex gap-2">
                    <button className="btn btn-primary" onClick={() => act(() => api("POST", `/admin/parties/${p.publicCode}/approve`, { decision: "APPROVE" }))}>
                      {t.approve}
                    </button>
                    <button className="btn btn-outline" onClick={() => act(() => api("POST", `/admin/parties/${p.publicCode}/approve`, { decision: "REJECT" }))}>
                      {t.reject}
                    </button>
                  </div>
                </div>
                <div className="grid gap-x-6 gap-y-1 border-t pt-2 text-xs md:grid-cols-2" style={{ borderColor: "var(--color-border)" }}>
                  <p><span style={{ color: "var(--color-muted)" }}>{t.company}: </span>{p.companyName}</p>
                  <p><span style={{ color: "var(--color-muted)" }}>{t.taxId}: </span>{p.taxId ?? p.registrationNo ?? "—"}</p>
                  <p><span style={{ color: "var(--color-muted)" }}>{t.contact}: </span>{p.contactName ?? "—"}</p>
                  <p>
                    <span style={{ color: "var(--color-muted)" }}>{t.certs}: </span>
                    {p.certificates.length === 0
                      ? t.noCerts
                      : p.certificates.map((c) => `${c.certType} ${c.certNo}${c.expiryDate ? ` (→${c.expiryDate.slice(0, 10)})` : ""}`).join(" · ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== 产品审核（待审列表，一键通过/拒绝） ===== */}
      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.pendingProducts}</h2>
        {pendingProducts.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.empty}</p>
        ) : (
          <div className="space-y-3">
            {pendingProducts.map((p) => (
              <div key={p.code} className="card flex flex-wrap gap-4 text-sm">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt={p.name} className="h-24 w-32 rounded-md object-cover" />
                ) : (
                  <div className="flex h-24 w-32 items-center justify-center rounded-md text-2xl" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }} aria-hidden>◉</div>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono">{p.code}</span>
                    <span className="font-medium">{p.name}</span>
                    <span className="badge">{t.supplier}: {p.supplierCode}</span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {p.categoryCode}{p.speciesCode ? ` · ${p.speciesCode}` : ""}{p.gradeCode ? ` · ${p.gradeCode}` : ""} · HS {p.hsCode}
                  </p>
                  {p.skus.map((s) => (
                    <p key={s.skuCode} className="text-xs" style={{ color: "var(--color-muted)" }}>
                      {s.packSpec} · MOQ {s.moq} · {s.priceTiers.map((tier) => `${tier.qtyMin}-${tier.qtyMax ?? "∞"}kg €${tier.unitPrice}`).join(" / ")}
                    </p>
                  ))}
                  {p.description && <p className="text-xs" style={{ color: "var(--color-muted)" }}>{p.description.slice(0, 160)}</p>}
                </div>
                <div className="flex flex-col justify-center gap-2">
                  <button className="btn btn-primary" onClick={() => act(() => api("POST", `/admin/products/${p.code}/review`, { decision: "APPROVE" }))}>
                    {t.approve}
                  </button>
                  <button className="btn btn-outline" onClick={() => act(() => api("POST", `/admin/products/${p.code}/review`, { decision: "REJECT" }))}>
                    {t.reject}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
