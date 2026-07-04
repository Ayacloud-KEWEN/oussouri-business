import Link from "next/link";
import { getDictionary } from "@/lib/i18n";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const pillars = [
    { title: dict.home.pillar1, desc: dict.home.pillar1Desc },
    { title: dict.home.pillar2, desc: dict.home.pillar2Desc },
    { title: dict.home.pillar3, desc: dict.home.pillar3Desc },
  ];
  return (
    <div className="space-y-12 py-8">
      <section className="space-y-5 text-center">
        <p className="text-sm uppercase tracking-widest" style={{ color: "var(--color-accent)" }}>{dict.tagline}</p>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight">{dict.home.heroTitle}</h1>
        <p className="mx-auto max-w-2xl" style={{ color: "var(--color-muted)" }}>{dict.home.heroSubtitle}</p>
        <Link className="btn btn-primary px-8 py-3" href={`/${locale}/market`}>{dict.home.cta}</Link>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {pillars.map((p) => (
          <div key={p.title} className="card">
            <h2 className="mb-2 font-medium" style={{ color: "var(--color-accent)" }}>{p.title}</h2>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>{p.desc}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
