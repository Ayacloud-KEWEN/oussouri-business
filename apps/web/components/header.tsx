"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import { clearSession, getSession, type SessionInfo } from "@/lib/api";

const LOCALES = ["zh-CN", "en", "fr"] as const;
const LOCALE_LABELS: Record<string, string> = { "zh-CN": "中文", en: "EN", fr: "FR" };

export function Header({ locale, dict }: { locale: string; dict: Dictionary }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSessionState] = useState<SessionInfo | null>(null);

  useEffect(() => {
    const sync = () => setSessionState(getSession());
    sync();
    window.addEventListener("oussouri:session", sync);
    return () => window.removeEventListener("oussouri:session", sync);
  }, []);

  const switchLocale = (target: string): string => {
    const rest = pathname.replace(new RegExp(`^/${locale}`), "");
    return `/${target}${rest || ""}`;
  };

  const roles = session?.roles ?? [];
  const isAdmin = roles.some((r) => ["ADMIN", "SUPER_ADMIN"].includes(r));

  return (
    <header className="border-b" style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}>
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href={`/${locale}`} className="text-lg font-semibold tracking-wide" style={{ color: "var(--color-accent)" }}>
          {dict.brand}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href={`/${locale}/market`}>{dict.nav.market}</Link>
          {roles.includes("BUYER") && <Link href={`/${locale}/buyer`}>{dict.nav.buyer}</Link>}
          {roles.includes("SUPPLIER") && <Link href={`/${locale}/supplier`}>{dict.nav.supplier}</Link>}
          {isAdmin && <Link href={`/${locale}/admin`}>{dict.nav.admin}</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="flex gap-1 rounded-md border px-1 py-0.5" style={{ borderColor: "var(--color-border)" }}>
            {LOCALES.map((l) => (
              <Link
                key={l}
                href={switchLocale(l)}
                className="rounded px-1.5 py-0.5"
                style={l === locale ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" } : {}}
              >
                {LOCALE_LABELS[l]}
              </Link>
            ))}
          </span>
          {session ? (
            <>
              {session.orgCode && <span className="badge">{session.orgCode}</span>}
              <button
                className="btn btn-outline"
                onClick={() => {
                  clearSession();
                  router.push(`/${locale}`);
                }}
              >
                {dict.nav.logout}
              </button>
            </>
          ) : (
            <>
              <Link className="btn btn-outline" href={`/${locale}/login`}>{dict.nav.login}</Link>
              <Link className="btn btn-primary" href={`/${locale}/register`}>{dict.nav.register}</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
