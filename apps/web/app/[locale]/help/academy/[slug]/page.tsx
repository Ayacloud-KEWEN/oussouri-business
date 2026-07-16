import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { ACADEMY, ARTICLES } from "@/content/academy";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const article = ARTICLES.find((a) => a.slug === slug);
  return article ? { title: article.title[locale], description: article.subtitle[locale] } : {};
}

/** Markdown 元素统一使用站点变量配色（无 typography 插件，逐元素映射） */
const mdComponents = {
  h2: (p: React.ComponentProps<"h2">) => (
    <h2 className="mt-8 border-b pb-2 text-xl font-semibold" style={{ color: "var(--color-accent)", borderColor: "var(--color-border)" }} {...p} />
  ),
  h3: (p: React.ComponentProps<"h3">) => <h3 className="mt-6 text-base font-semibold" {...p} />,
  p: (p: React.ComponentProps<"p">) => <p className="mt-3 text-sm leading-relaxed" {...p} />,
  ul: (p: React.ComponentProps<"ul">) => <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed" {...p} />,
  ol: (p: React.ComponentProps<"ol">) => <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed" {...p} />,
  blockquote: (p: React.ComponentProps<"blockquote">) => (
    <blockquote
      className="mt-3 rounded-md border-l-4 p-3 text-sm leading-relaxed"
      style={{ borderColor: "var(--color-accent)", background: "var(--color-accent-soft)" }}
      {...p}
    />
  ),
  table: (p: React.ComponentProps<"table">) => (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  th: (p: React.ComponentProps<"th">) => (
    <th className="border px-2.5 py-1.5 text-left font-medium" style={{ borderColor: "var(--color-border)", background: "var(--color-accent-soft)" }} {...p} />
  ),
  td: (p: React.ComponentProps<"td">) => <td className="border px-2.5 py-1.5 align-top" style={{ borderColor: "var(--color-border)" }} {...p} />,
  strong: (p: React.ComponentProps<"strong">) => <strong className="font-semibold" style={{ color: "var(--color-accent)" }} {...p} />,
};

export default async function AcademyArticlePage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const article = ARTICLES.find((a) => a.slug === slug);
  if (!article) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <p className="text-xs">
        <Link href={`/${locale}/help/academy`} style={{ color: "var(--color-accent)" }}>‹ {ACADEMY.nav[locale]}</Link>
      </p>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold leading-snug">{article.title[locale]}</h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>{article.subtitle[locale]} · ≈ {article.readMin} min</p>
      </header>
      <article>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {article.body[locale] ?? article.body[DEFAULT_LOCALE]!}
        </ReactMarkdown>
      </article>
      <div className="border-t pt-6 text-center" style={{ borderColor: "var(--color-border)" }}>
        <Link className="btn btn-primary px-8 py-3" href={`/${locale}/register`}>Oussouri Caviar HUB ›</Link>
      </div>
    </div>
  );
}
