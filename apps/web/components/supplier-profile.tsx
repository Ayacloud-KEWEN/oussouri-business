"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

interface Contact { id: string; name: string; phone: string | null; email: string | null; position: string | null; isPrimary: boolean }
interface Certificate { id: string; certType: string; certNo: string; issuer: string | null; issueDate: string | null; expiryDate: string | null; status: string }
interface Permit { permitNo: string; speciesCode: string; quotaKg: string; usedKg: string; expiryDate: string; status: string }

const CERT_TYPES = ["EXPORT_LICENSE", "SC", "HACCP", "ISO22000", "CITES", "EU_ESTABLISHMENT", "OTHERS"];
const d10 = (v: string | null) => (v ? v.slice(0, 10) : "—");

/**
 * 企业档案自助维护（R1.6-2）：联系人、资质证书、CITES 配额。
 * 此前只能由运营脚本代录，是接新供应商的瓶颈。
 */
export function SupplierProfile({ dict, orgCode }: { dict: Dictionary; orgCode?: string }) {
  const t = dict.profile;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState({ name: "", position: "", phone: "", email: "", isPrimary: false });
  const [certForm, setCertForm] = useState({ certType: "EXPORT_LICENSE", certNo: "", issuer: "", issueDate: "", expiryDate: "" });
  const [permitForm, setPermitForm] = useState({ permitNo: "", speciesCode: "SCHDAU", quotaKg: 50, issueDate: "", expiryDate: "" });

  const refresh = useCallback(async () => {
    const [c, ce, p] = await Promise.all([
      api<Contact[]>("GET", "/party/contacts").catch(() => []),
      api<Certificate[]>("GET", "/party/certificates").catch(() => []),
      api<Permit[]>("GET", "/customs/cites-permits").catch(() => []),
    ]);
    setContacts(c); setCerts(ce); setPermits(p);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await fn();
      await refresh();
      setMessage(dict.common.success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{t.title}</h2>
        <span className="text-xs" style={{ color: "var(--color-muted)" }}>{t.privacyNote}</span>
      </div>
      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 联系人 */}
        <div className="card space-y-3">
          <h3 className="text-sm font-medium">{t.contacts}</h3>
          {contacts.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>{t.empty}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 border-t pt-1.5" style={{ borderColor: "var(--color-border)" }}>
                  <span className="font-medium">{c.name}</span>
                  {c.isPrimary && <span className="badge">{t.primary}</span>}
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>{c.position ?? "—"} · {c.phone ?? "—"} · {c.email ?? "—"}</span>
                  <button className="ml-auto text-xs" style={{ color: "var(--color-warning)" }} onClick={() => act(() => api("DELETE", `/party/contacts/${c.id}`))}>
                    {t.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api("POST", "/party/contacts", {
                  name: contactForm.name, position: contactForm.position || undefined,
                  phone: contactForm.phone || undefined, email: contactForm.email || undefined,
                  isPrimary: contactForm.isPrimary,
                });
                setContactForm({ name: "", position: "", phone: "", email: "", isPrimary: false });
              });
            }}
          >
            <input className="input" placeholder={t.name} required value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} />
            <input className="input" placeholder={t.position} value={contactForm.position} onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })} />
            <input className="input" placeholder={t.phone} value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} />
            <input className="input" type="email" placeholder={t.email} value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} />
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-muted)" }}>
              <input type="checkbox" checked={contactForm.isPrimary} onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })} />
              {t.setPrimary}
            </label>
            <button className="btn btn-primary" type="submit">{t.add}</button>
          </form>
        </div>

        {/* 资质证书 */}
        <div className="card space-y-3">
          <h3 className="text-sm font-medium">{t.certificates}</h3>
          {certs.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>{t.empty}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {certs.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 border-t pt-1.5" style={{ borderColor: "var(--color-border)" }}>
                  <span className="font-medium">{c.certType}</span>
                  <span className="font-mono text-xs" style={{ color: "var(--color-muted)" }}>{c.certNo}</span>
                  <span className="badge">{c.status}</span>
                  {c.expiryDate && <span className="text-xs" style={{ color: "var(--color-muted)" }}>{t.expiry} {d10(c.expiryDate)}</span>}
                  <button className="ml-auto text-xs" style={{ color: "var(--color-warning)" }} onClick={() => act(() => api("DELETE", `/party/certificates/${c.id}`))}>
                    {t.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api("POST", "/party/certificates", {
                  certType: certForm.certType, certNo: certForm.certNo,
                  issuer: certForm.issuer || undefined,
                  issueDate: certForm.issueDate || undefined, expiryDate: certForm.expiryDate || undefined,
                });
                setCertForm({ certType: "EXPORT_LICENSE", certNo: "", issuer: "", issueDate: "", expiryDate: "" });
              });
            }}
          >
            <select className="input" value={certForm.certType} onChange={(e) => setCertForm({ ...certForm, certType: e.target.value })}>
              {CERT_TYPES.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
            </select>
            <input className="input" placeholder={t.certNo} required value={certForm.certNo} onChange={(e) => setCertForm({ ...certForm, certNo: e.target.value })} />
            <input className="input" placeholder={t.issuer} value={certForm.issuer} onChange={(e) => setCertForm({ ...certForm, issuer: e.target.value })} />
            <input className="input" type="date" title={t.expiry} value={certForm.expiryDate} onChange={(e) => setCertForm({ ...certForm, expiryDate: e.target.value })} />
            <button className="btn btn-primary sm:col-span-2" type="submit">{t.add}</button>
          </form>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>{t.certReviewNote}</p>
        </div>
      </div>

      {/* CITES 配额 */}
      <div className="card space-y-3">
        <h3 className="text-sm font-medium">{t.citesQuota}</h3>
        {permits.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>{t.empty}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {permits.map((p) => {
                const used = Number(p.usedKg);
                const quota = Number(p.quotaKg);
                return (
                  <tr key={p.permitNo} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="py-1.5 font-mono text-xs">{p.permitNo}</td>
                    <td className="py-1.5">{p.speciesCode}</td>
                    <td className="py-1.5 text-right" style={{ color: "var(--color-muted)" }}>
                      {used} / {quota} kg（{t.remaining} {(quota - used).toFixed(0)}）
                    </td>
                    <td className="py-1.5 pl-2 text-right text-xs" style={{ color: "var(--color-muted)" }}>{t.expiry} {d10(p.expiryDate)}</td>
                    <td className="py-1.5 pl-2 text-right"><span className="badge">{p.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form
          className="grid gap-2 sm:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api("POST", "/customs/cites-permits", {
                supplierOrgCode: orgCode, permitNo: permitForm.permitNo, speciesCode: permitForm.speciesCode,
                quotaKg: Number(permitForm.quotaKg),
                issueDate: permitForm.issueDate || new Date().toISOString().slice(0, 10),
                expiryDate: permitForm.expiryDate,
              });
              setPermitForm({ permitNo: "", speciesCode: "SCHDAU", quotaKg: 50, issueDate: "", expiryDate: "" });
            });
          }}
        >
          <input className="input" placeholder={t.permitNo} required value={permitForm.permitNo} onChange={(e) => setPermitForm({ ...permitForm, permitNo: e.target.value })} />
          <input className="input" placeholder={t.species} required value={permitForm.speciesCode} onChange={(e) => setPermitForm({ ...permitForm, speciesCode: e.target.value })} />
          <input className="input" type="number" step="0.001" placeholder={t.quotaKg} required value={permitForm.quotaKg} onChange={(e) => setPermitForm({ ...permitForm, quotaKg: Number(e.target.value) })} />
          <input className="input" type="date" required title={t.expiry} value={permitForm.expiryDate} onChange={(e) => setPermitForm({ ...permitForm, expiryDate: e.target.value })} />
          <button className="btn btn-primary" type="submit">{t.add}</button>
        </form>
      </div>
    </section>
  );
}
