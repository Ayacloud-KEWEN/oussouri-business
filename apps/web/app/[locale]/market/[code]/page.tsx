import { getDictionary } from "@/lib/i18n";
import { serverApi } from "@/lib/server-api";
import { ProductActions } from "@/components/product-actions";

/** 产品结构化品质数据（Product.attributes）；内容侧保证不含供应商身份标识 */
interface ProductAttributes {
  features?: string[];
  tasting?: string[];
  pairing?: string[];
  nutrition?: { label: string; value: string; unit: string }[];
  nutritionNote?: string;
  processNote?: string;
}

interface PublicProduct {
  code: string;
  image: string | null;
  name: string;
  description: string | null;
  attributes: ProductAttributes | null;
  category: string;
  species: string | null;
  grade: string | null;
  originCountry: string;
  supplierCode: string;
  skus: { skuCode: string; packSpec: string; moq: string; unit: string }[];
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="card space-y-2">
      <h2 className="text-sm font-medium" style={{ color: "var(--color-accent)" }}>{title}</h2>
      <ul className="space-y-1.5 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span style={{ color: "var(--color-accent)" }}>▸</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  const dict = getDictionary(locale);
  const t = dict.market;
  const product = await serverApi<PublicProduct>(`/products/${code}?locale=${encodeURIComponent(locale)}`);
  if (!product) return <p>{t.empty}</p>;
  const attrs = product.attributes ?? {};
  const hasQualityData = Boolean(attrs.features?.length || attrs.nutrition?.length || attrs.tasting?.length || attrs.pairing?.length);

  return (
    <div className="space-y-8">
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
            <span className="badge">{product.supplierCode} · {t.verified}</span>
            <h1 className="text-2xl font-semibold">{product.name}</h1>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              {t.species}: {product.species ?? "—"} · {t.grade}: {product.grade ?? "—"} · {t.origin}: {product.originCountry}
            </p>
            {product.description && (
              <p className="pt-1 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>{product.description}</p>
            )}
          </div>
          <ProductActions locale={locale} code={product.code} dict={dict} />
        </div>
      </div>

      {hasQualityData && (
        <div className="grid gap-4 lg:grid-cols-2">
          {attrs.features?.length ? <Bullets title={t.productFeatures} items={attrs.features} /> : null}

          {attrs.nutrition?.length ? (
            <section className="card space-y-2">
              <h2 className="text-sm font-medium" style={{ color: "var(--color-accent)" }}>{t.nutritionFacts}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {attrs.nutrition.map((n) => (
                      <tr key={n.label} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                        <td className="py-1.5 pr-3" style={{ color: "var(--color-muted)" }}>{n.label}</td>
                        <td className="whitespace-nowrap py-1.5 text-right font-medium">
                          {n.value} <span className="font-normal" style={{ color: "var(--color-muted)" }}>{n.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {attrs.nutritionNote && (
                <p className="border-t pt-2 text-[11px]" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>
                  {attrs.nutritionNote}
                </p>
              )}
            </section>
          ) : null}

          {attrs.tasting?.length ? <Bullets title={t.tastingNotes} items={attrs.tasting} /> : null}
          {attrs.pairing?.length ? <Bullets title={t.pairingSuggestions} items={attrs.pairing} /> : null}
        </div>
      )}

      {attrs.processNote && <p className="text-xs" style={{ color: "var(--color-muted)" }}>{attrs.processNote}</p>}
    </div>
  );
}
