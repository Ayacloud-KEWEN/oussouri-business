import Link from "next/link";
import type { Metadata } from "next";
import { isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { ACADEMY, ARTICLES } from "@/content/academy";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return { title: ACADEMY.title[locale], description: ACADEMY.subtitle[locale] };
}

export default async function AcademyIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <header className="space-y-3 text-center">
        <h1 className="text-3xl font-semibold">{ACADEMY.title[locale]}</h1>
        <p style={{ color: "var(--color-muted)" }}>{ACADEMY.subtitle[locale]}</p>
      </header>
      <div className="space-y-4">
        {ARTICLES.map((a) => (
          <Link key={a.slug} href={`/${locale}/help/academy/${a.slug}`} className="card block space-y-2 transition-shadow hover:shadow-md">
            <h2 className="text-lg font-medium" style={{ color: "var(--color-accent)" }}>{a.title[locale]}</h2>
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>{a.subtitle[locale]}</p>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>≈ {a.readMin} min</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
