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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false); // 路由变化自动收起手机菜单
  }, [pathname]);

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
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <button
          className="btn btn-outline px-2.5 md:hidden"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
        <Link href={`/${locale}`} className="whitespace-nowrap text-base font-semibold tracking-wide md:text-lg" style={{ color: "var(--color-accent)" }}>
          {dict.brand}
        </Link>
        <nav className="hidden items-center gap-4 whitespace-nowrap text-sm md:flex [&>a]:whitespace-nowrap">
          <Link className="hidden lg:inline" href={`/${locale}#insights`}>{dict.portal.navInsights}</Link>
          <Link href={`/${locale}/market`}>{dict.portal.navMarketplace}</Link>
          <Link href={`/${locale}#rfq`}>{dict.portal.navRfq}</Link>
          <Link className="hidden lg:inline" href={`/${locale}#origins`}>{dict.portal.navOrigins}</Link>
          <Link className="hidden lg:inline" href={`/${locale}#buyers`}>{dict.portal.navBuyers}</Link>
          <Link href={`/${locale}/help`}>{dict.help.nav}</Link>
          {roles.includes("BUYER") && <Link href={`/${locale}/buyer`}>{dict.nav.buyer}</Link>}
          {roles.includes("SUPPLIER") && <Link href={`/${locale}/supplier`}>{dict.nav.supplier}</Link>}
          {roles.includes("BROKER") && <Link href={`/${locale}/broker`}>{dict.broker.nav}</Link>}
          {isAdmin && <Link href={`/${locale}/admin`}>{dict.nav.admin}</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-3 whitespace-nowrap text-sm">
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
                className="btn btn-outline whitespace-nowrap"
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
              <Link className="btn btn-outline whitespace-nowrap" href={`/${locale}/login`}>{dict.nav.login}</Link>
              <Link className="btn btn-primary whitespace-nowrap" href={`/${locale}/register`}>{dict.nav.register}</Link>
            </>
          )}
        </div>
      </div>
      {menuOpen && (
        <nav
          className="flex flex-col gap-1 border-t px-4 py-3 text-sm md:hidden"
          style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
        >
          <Link className="py-1.5" href={`/${locale}#insights`}>{dict.portal.navInsights}</Link>
          <Link className="py-1.5" href={`/${locale}/market`}>{dict.portal.navMarketplace}</Link>
          <Link className="py-1.5" href={`/${locale}#rfq`}>{dict.portal.navRfq}</Link>
          <Link className="py-1.5" href={`/${locale}#origins`}>{dict.portal.navOrigins}</Link>
          <Link className="py-1.5" href={`/${locale}#buyers`}>{dict.portal.navBuyers}</Link>
          <Link className="py-1.5" href={`/${locale}/help`}>{dict.help.nav}</Link>
          {roles.includes("BUYER") && <Link className="py-1.5" href={`/${locale}/buyer`} style={{ color: "var(--color-accent)" }}>{dict.nav.buyer}</Link>}
          {roles.includes("SUPPLIER") && <Link className="py-1.5" href={`/${locale}/supplier`} style={{ color: "var(--color-accent)" }}>{dict.nav.supplier}</Link>}
          {roles.includes("BROKER") && <Link className="py-1.5" href={`/${locale}/broker`} style={{ color: "var(--color-accent)" }}>{dict.broker.nav}</Link>}
          {isAdmin && <Link className="py-1.5" href={`/${locale}/admin`} style={{ color: "var(--color-accent)" }}>{dict.nav.admin}</Link>}
        </nav>
      )}
    </header>
  );
}
