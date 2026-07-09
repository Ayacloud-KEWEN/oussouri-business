import { getDictionary } from "@/lib/i18n";
import { serverApi } from "@/lib/server-api";
import { ProductActions } from "@/components/product-actions";

interface PublicProduct {
  code: string;
  image: string | null;
  name: string;
  category: string;
  species: string | null;
  grade: string | null;
  originCountry: string;
  supplierCode: string;
  skus: { skuCode: string; packSpec: string; moq: string; unit: string }[];
}

export default async function ProductPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  const dict = getDictionary(locale);
  const product = await serverApi<PublicProduct>(`/products/${code}`);
  if (!product) return <p>{dict.market.empty}</p>;

  return (
    <div className="grid gap-8 md:grid-cols-2">
      {product.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image} alt={product.name} className="min-h-72 w-full rounded-lg object-cover" />
      ) : (
        <div
          className="flex min-h-72 items-center justify-center rounded-lg text-7xl"
          style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
          aria-hidden
        >
          ◉
        </div>
      )}
      <div className="space-y-5">
        <div className="space-y-2">
          <span className="badge">{product.supplierCode} · {dict.market.verified}</span>
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            {dict.market.species}: {product.species ?? "—"} · {dict.market.grade}: {product.grade ?? "—"} · {dict.market.origin}: {product.originCountry}
          </p>
        </div>
        <ProductActions locale={locale} code={product.code} dict={dict} />
      </div>
    </div>
  );
}
