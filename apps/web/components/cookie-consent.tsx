"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";

const CONSENT_KEY = "oussouri.cookieConsent";

export function CookieConsent({ locale, dict }: { locale: string; dict: Dictionary }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(window.localStorage.getItem(CONSENT_KEY) !== "accepted");
  }, []);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={dict.gdpr.learnMore}
      className="fixed inset-x-0 bottom-0 z-50 border-t px-4 py-3"
      style={{ background: "var(--color-card)", borderColor: "var(--color-border)" }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <p className="flex-1 text-sm" style={{ color: "var(--color-muted)", minWidth: "240px" }}>
          {dict.gdpr.banner}{" "}
          <Link href={`/${locale}/privacy`} style={{ color: "var(--color-accent)" }}>{dict.gdpr.learnMore}</Link>
        </p>
        <button
          className="btn btn-primary whitespace-nowrap"
          onClick={() => {
            window.localStorage.setItem(CONSENT_KEY, "accepted");
            setVisible(false);
          }}
        >
          {dict.gdpr.accept}
        </button>
      </div>
    </div>
  );
}
