import Link from "next/link";
import type { Metadata } from "next";
import { getDictionary, isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { ACADEMY, ARTICLES } from "@/content/academy";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return { title: dict.help.title, description: dict.help.subtitle };
}

function Steps({ title, steps }: { title: string; steps: { t: string; d: string }[] }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold" style={{ color: "var(--color-accent)" }}>{title}</h2>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.t} className="card flex gap-4">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              style={{ background: "var(--color-accent)", color: "var(--color-primary-foreground)" }}
              aria-hidden
            >
              {i + 1}
            </span>
            <div>
              <h3 className="font-medium">{s.t}</h3>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function HelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const t = dict.help;

  return (
    <div className="mx-auto max-w-3xl space-y-12 py-6">
      <header className="space-y-3 text-center">
        <h1 className="text-3xl font-semibold">{t.title}</h1>
        <p style={{ color: "var(--color-muted)" }}>{t.subtitle}</p>
      </header>

      {/* 场景导航：不读文档也能直接开始 */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold" style={{ color: "var(--color-accent)" }}>{t.quickTitle}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {t.quick.map((q) => (
            <Link key={q.t} href={`/${locale}${q.href}`} className="card block space-y-1 transition-shadow hover:shadow-md">
              <p className="font-medium">{q.t} ›</p>
              <p className="text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>{q.d}</p>
            </Link>
          ))}
        </div>
        <div className="card space-y-1.5 text-sm" style={{ background: "var(--color-accent-soft)" }}>
          <p className="font-medium">{t.roleHintTitle}</p>
          <p style={{ color: "var(--color-muted)" }}>· {t.roleHintBuyer}</p>
          <p style={{ color: "var(--color-muted)" }}>· {t.roleHintSupplier}</p>
          <p className="pt-1" style={{ color: "var(--color-accent)" }}>💡 {t.loginTip}</p>
        </div>
      </section>

      <Steps title={t.buyerTitle} steps={t.buyerSteps} />
      <Steps title={t.supplierTitle} steps={t.supplierSteps} />

      {/* 外贸学院入口（R1.5-5） */}
      <Link
        href={`/${locale}/help/academy`}
        className="card block space-y-1.5 border-2 transition-shadow hover:shadow-md"
        style={{ borderColor: "var(--color-accent)" }}
      >
        <p className="text-xs tracking-widest" style={{ color: "var(--color-accent)" }}>📚 {ACADEMY.nav[locale]} · ACADEMY</p>
        <h2 className="text-lg font-medium">{ARTICLES[0]!.title[locale]}</h2>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>{ARTICLES[0]!.subtitle[locale]}</p>
      </Link>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold" style={{ color: "var(--color-accent)" }}>{t.rulesTitle}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {t.rules.map((r) => (
            <div key={r.t} className="card">
              <h3 className="font-medium" style={{ color: "var(--color-warning)" }}>⚠ {r.t}</h3>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>{r.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 术语速查：B2B 外贸术语是新手最大的门槛 */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold" style={{ color: "var(--color-accent)" }}>{t.glossaryTitle}</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {t.glossary.map((g) => (
            <div key={g.t} className="card">
              <dt className="text-sm font-medium">{g.t}</dt>
              <dd className="mt-1 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>{g.d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold" style={{ color: "var(--color-accent)" }}>{t.faqTitle}</h2>
        <div className="space-y-3">
          {[...t.faqExtra, ...t.faq].map((f) => (
            <details key={f.q} className="card">
              <summary className="cursor-pointer font-medium">{f.q}</summary>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="text-center">
        <Link className="btn btn-primary px-8 py-3" href={`/${locale}/register`}>{t.cta}</Link>
      </div>
    </div>
  );
}
