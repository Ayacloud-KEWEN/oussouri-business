"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

interface Contact { id: string; name: string; phone: string | null; email: string | null; position: string | null; isPrimary: boolean }
interface Certificate { id: string; certType: string; certNo: string; issuer: string | null; issueDate: string | null; expiryDate: string | null; status: string }
interface PermitLine { speciesCode: string; quotaKg: string; usedKg: string; remainingKg: string; labelRange: string | null }
interface Permit {
  permitNo: string; speciesCode: string; quotaKg: string; usedKg: string;
  expiryDate: string; daysToExpiry: number; status: string; lines: PermitLine[];
}

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
  const [permitForm, setPermitForm] = useState<{
    permitNo: string; issueDate: string; expiryDate: string;
    lines: { speciesCode: string; quotaKg: number; labelRange: string }[];
  }>({ permitNo: "", issueDate: "", expiryDate: "", lines: [{ speciesCode: "SCHDAU", quotaKg: 50, labelRange: "" }] });

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
          // 配额驾驶舱：一证多物种逐行展示用量条与临期提醒（R1.5-3）
          <div className="space-y-3">
            {permits.map((p) => {
              const expiringSoon = p.status === "VALID" && p.daysToExpiry <= 60;
              const expired = p.status !== "VALID" || p.daysToExpiry < 0;
              return (
                <div key={p.permitNo} className="rounded-md border p-2.5" style={{ borderColor: "var(--color-border)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-medium">{p.permitNo}</span>
                    <span className="badge">{p.status}</span>
                    <span
                      className="text-xs"
                      style={{ color: expired ? "var(--color-warning)" : expiringSoon ? "var(--color-warning)" : "var(--color-muted)" }}
                    >
                      {t.expiry} {d10(p.expiryDate)}
                      {expired ? ` · ${t.expiredTag}` : expiringSoon ? ` · ${t.expiringIn.replace("{days}", String(p.daysToExpiry))}` : ""}
                    </span>
                    <span className="ml-auto text-xs" style={{ color: "var(--color-muted)" }}>
                      {t.remaining} {(Number(p.quotaKg) - Number(p.usedKg)).toFixed(0)} / {Number(p.quotaKg).toFixed(0)} kg
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {(p.lines.length > 0 ? p.lines : [{ speciesCode: p.speciesCode, quotaKg: p.quotaKg, usedKg: p.usedKg, remainingKg: String(Number(p.quotaKg) - Number(p.usedKg)), labelRange: null }]).map((l) => {
                      const pct = Number(l.quotaKg) > 0 ? (Number(l.usedKg) / Number(l.quotaKg)) * 100 : 0;
                      return (
                        <li key={l.speciesCode} className="space-y-0.5 text-xs">
                          <div className="flex justify-between">
                            <span>
                              {l.speciesCode}
                              {l.labelRange && <span style={{ color: "var(--color-muted)" }}> · {l.labelRange}</span>}
                            </span>
                            <span style={{ color: "var(--color-muted)" }}>
                              {Number(l.usedKg).toFixed(0)} / {Number(l.quotaKg).toFixed(0)} kg（{t.remaining} {Number(l.remainingKg).toFixed(0)}）
                            </span>
                          </div>
                          <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: "var(--color-accent)" }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        {/* 一证多物种：可继续添加物种行（R1.5-3） */}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api("POST", "/customs/cites-permits", {
                supplierOrgCode: orgCode,
                permitNo: permitForm.permitNo,
                issueDate: permitForm.issueDate || new Date().toISOString().slice(0, 10),
                expiryDate: permitForm.expiryDate,
                lines: permitForm.lines.map((l) => ({
                  speciesCode: l.speciesCode, quotaKg: Number(l.quotaKg), labelRange: l.labelRange || undefined,
                })),
              });
              setPermitForm({ permitNo: "", issueDate: "", expiryDate: "", lines: [{ speciesCode: "SCHDAU", quotaKg: 50, labelRange: "" }] });
            });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="input" placeholder={t.permitNo} required value={permitForm.permitNo} onChange={(e) => setPermitForm({ ...permitForm, permitNo: e.target.value })} />
            <input className="input" type="date" title={t.issueDate} value={permitForm.issueDate} onChange={(e) => setPermitForm({ ...permitForm, issueDate: e.target.value })} />
            <input className="input" type="date" required title={t.expiry} value={permitForm.expiryDate} onChange={(e) => setPermitForm({ ...permitForm, expiryDate: e.target.value })} />
          </div>
          {permitForm.lines.map((line, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-4">
              <input
                className="input" placeholder={t.species} required value={line.speciesCode}
                onChange={(e) => setPermitForm({ ...permitForm, lines: permitForm.lines.map((l, j) => (j === i ? { ...l, speciesCode: e.target.value } : l)) })}
              />
              <input
                className="input" type="number" step="0.001" placeholder={t.quotaKg} required value={line.quotaKg}
                onChange={(e) => setPermitForm({ ...permitForm, lines: permitForm.lines.map((l, j) => (j === i ? { ...l, quotaKg: Number(e.target.value) } : l)) })}
              />
              <input
                className="input" placeholder={t.labelRange} value={line.labelRange}
                onChange={(e) => setPermitForm({ ...permitForm, lines: permitForm.lines.map((l, j) => (j === i ? { ...l, labelRange: e.target.value } : l)) })}
              />
              {permitForm.lines.length > 1 && (
                <button type="button" className="text-xs" style={{ color: "var(--color-warning)" }} onClick={() => setPermitForm({ ...permitForm, lines: permitForm.lines.filter((_, j) => j !== i) })}>
                  {t.remove}
                </button>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button" className="btn btn-outline text-xs"
              onClick={() => setPermitForm({ ...permitForm, lines: [...permitForm.lines, { speciesCode: "", quotaKg: 0, labelRange: "" }] })}
            >
              + {t.addSpecies}
            </button>
            <button className="btn btn-primary" type="submit">{t.add}</button>
          </div>
        </form>
      </div>
    </section>
  );
}
