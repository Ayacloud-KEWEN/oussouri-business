import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { serverApi } from "@/lib/server-api";

interface PublicSku {
  skuCode: string;
  packSpec: string;
  moq: string;
  priceTiers: { currency: string; qtyMin: string; qtyMax: string | null; unitPrice: string }[] | "LOGIN_REQUIRED";
}
interface PublicProduct {
  code: string;
  image: string | null;
  name: string;
  category: string;
  species: string | null;
  grade: string | null;
  originCountry: string;
  supplierCode: string;
  skus: PublicSku[];
}

export default async function MarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  const dict = getDictionary(locale);
  const query = q?.trim() ? `&q=${encodeURIComponent(q.trim())}` : "";
  const result = await serverApi<{ data: PublicProduct[] }>(`/products?pageSize=50&locale=${encodeURIComponent(locale)}${query}`);
  const products = result?.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{dict.market.title}</h1>
      <form className="flex max-w-md gap-2" action={`/${locale}/market`} method="get">
        <input className="input flex-1" type="search" name="q" defaultValue={q ?? ""} placeholder={dict.market.searchPlaceholder} />
        <button className="btn btn-primary" type="submit">{dict.market.search}</button>
        {q && (
          <Link className="btn btn-outline" href={`/${locale}/market`}>
            {dict.market.clearSearch}
          </Link>
        )}
      </form>
      {products.length === 0 && <p style={{ color: "var(--color-muted)" }}>{dict.market.empty}</p>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => {
          const firstTier = Array.isArray(p.skus[0]?.priceTiers) ? p.skus[0].priceTiers[0] : null;
          return (
            <Link key={p.code} href={`/${locale}/market/${p.code}`} className="card block space-y-3 transition-shadow hover:shadow-md">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image} alt={p.name} className="h-36 w-full rounded-md object-cover" />
              ) : (
                <div
                  className="flex h-36 items-center justify-center rounded-md text-4xl"
                  style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                  aria-hidden
                >
                  ◉
                </div>
              )}
              <div className="space-y-1">
                <h2 className="font-medium leading-snug">{p.name}</h2>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {dict.market.species}: {p.species ?? "—"} · {dict.market.grade}: {p.grade ?? "—"} · {dict.market.origin}: {p.originCountry}
                </p>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="badge">{p.supplierCode} · {dict.market.verified}</span>
                {firstTier ? (
                  <span className="font-medium">€{firstTier.unitPrice} {dict.market.from}</span>
                ) : (
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>{dict.market.loginForPrice}</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
