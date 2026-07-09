import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return { title: dict.privacy.title };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const t = dict.privacy;

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{t.title}</h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.updated}</p>
      </header>
      <div className="space-y-4">
        {t.sections.map((s, i) => (
          <section key={s.t} className="card">
            <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>
              {i + 1}. {s.t}
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>{s.d}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
