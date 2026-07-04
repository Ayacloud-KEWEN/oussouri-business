"use client";

import { use, useCallback, useEffect, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

interface PendingParty { publicCode: string; partyType: string; countryIso2: string; submittedAt: string }

export default function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  const [pending, setPending] = useState<PendingParty[]>([]);
  const [productCode, setProductCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await api<{ data: PendingParty[] }>("GET", "/admin/parties?page=1&pageSize=50").catch(() => ({ data: [] }));
    setPending(res.data);
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
      <h1 className="text-2xl font-semibold">{dict.admin.title}</h1>
      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{dict.admin.pendingParties}</h2>
        {pending.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>{dict.admin.empty}</p>
        ) : (
          <div className="card space-y-2">
            {pending.map((p) => (
              <div key={p.publicCode} className="flex items-center gap-3 text-sm">
                <span className="font-mono">{p.publicCode}</span>
                <span className="badge">{p.partyType}</span>
                <span style={{ color: "var(--color-muted)" }}>{p.countryIso2}</span>
                <div className="ml-auto flex gap-2">
                  <button className="btn btn-primary" onClick={() => act(() => api("POST", `/admin/parties/${p.publicCode}/approve`, { decision: "APPROVE" }))}>
                    {dict.admin.approve}
                  </button>
                  <button className="btn btn-outline" onClick={() => act(() => api("POST", `/admin/parties/${p.publicCode}/approve`, { decision: "REJECT" }))}>
                    {dict.admin.reject}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{dict.admin.productReview}</h2>
        <form
          className="card flex items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); void act(() => api("POST", `/admin/products/${productCode}/review`, { decision: "APPROVE" })); }}
        >
          <div className="flex-1">
            <label className="label">PRD</label>
            <input className="input" value={productCode} onChange={(e) => setProductCode(e.target.value)} placeholder="PRD-000123" required />
          </div>
          <button className="btn btn-primary" type="submit">{dict.admin.review}</button>
        </form>
      </section>
    </div>
  );
}
