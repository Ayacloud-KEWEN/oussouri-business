import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import { Header } from "@/components/header";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return {
    title: { default: dict.brand, template: `%s · ${dict.brand}` },
    description: dict.tagline,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <Header locale={locale} dict={dict} />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-10 text-xs" style={{ color: "var(--color-muted)" }}>
          © 2026 {dict.brand} · oussouri.fr / oussouri.com
        </footer>
      </body>
    </html>
  );
}
