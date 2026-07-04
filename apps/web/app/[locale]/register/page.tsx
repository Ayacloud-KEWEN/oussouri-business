"use client";

import { use, useState } from "react";
import { getDictionary, interpolate } from "@/lib/i18n";
import { api } from "@/lib/api";

const BUYER_TYPES = ["WHOLESALER", "RETAILER", "RESTAURANT", "IMPORTER", "DISTRIBUTOR"] as const;

export default function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const dict = getDictionary(locale);
  const [form, setForm] = useState({
    partyType: "BUYER" as "BUYER" | "SUPPLIER",
    email: "",
    password: "",
    displayName: "",
    companyName: "",
    countryIso2: "FR",
    buyerType: "IMPORTER",
  });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ orgCode: string }>("POST", "/auth/register", {
        ...form,
        locale,
        buyerType: form.partyType === "BUYER" ? form.buyerType : undefined,
      });
      setResult(interpolate(dict.auth.registered, { code: res.orgCode }));
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.common.error);
    }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-md py-16">
        <div className="card space-y-2 text-center">
          <p className="text-3xl" aria-hidden>✓</p>
          <p>{result}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">{dict.auth.register}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>{dict.auth.pendingNote}</p>
      </div>
      <form className="card space-y-4" onSubmit={submit}>
        <div>
          <label className="label">{dict.auth.partyType}</label>
          <div className="flex gap-2">
            {(["BUYER", "SUPPLIER"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className="btn flex-1"
                style={form.partyType === t ? { background: "var(--color-primary)", color: "var(--color-primary-foreground)" } : { border: "1px solid var(--color-border)" }}
                onClick={() => set("partyType", t)}
              >
                {t === "BUYER" ? dict.auth.buyer : dict.auth.supplier}
              </button>
            ))}
          </div>
        </div>
        {form.partyType === "BUYER" && (
          <div>
            <label className="label">{dict.auth.buyerType}</label>
            <select className="input" value={form.buyerType} onChange={(e) => set("buyerType", e.target.value)}>
              {BUYER_TYPES.map((t) => (
                <option key={t} value={t}>{dict.auth.buyerTypes[t]}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">{dict.auth.companyName}</label>
          <input className="input" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} required maxLength={200} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{dict.auth.displayName}</label>
            <input className="input" value={form.displayName} onChange={(e) => set("displayName", e.target.value)} required maxLength={50} />
          </div>
          <div>
            <label className="label">{dict.auth.country}</label>
            <input className="input" value={form.countryIso2} onChange={(e) => set("countryIso2", e.target.value.toUpperCase())} required maxLength={2} />
          </div>
        </div>
        <div>
          <label className="label">{dict.auth.email}</label>
          <input className="input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
        </div>
        <div>
          <label className="label">{dict.auth.password}</label>
          <input className="input" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={10} />
        </div>
        {error && <p className="text-sm" style={{ color: "var(--color-destructive)" }}>{error}</p>}
        <button className="btn btn-primary w-full" type="submit">{dict.auth.submit}</button>
      </form>
    </div>
  );
}
