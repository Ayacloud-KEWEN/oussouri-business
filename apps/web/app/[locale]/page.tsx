import Link from "next/link";
import { getDictionary, isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { BUYER_DEMANDS, MARKET_INSIGHTS, ORIGINS, PLATFORM_STATS, RFQ_LIST, type LocalizedName } from "@/lib/portal-data";

const C = {
  bg: "#0a1628",
  panel: "#101f36",
  panelSoft: "#0d1a2e",
  border: "#1e3a5c",
  gold: "#c9a55c",
  text: "#e8ecf2",
  muted: "#8fa3bc",
  up: "#4ecb8f",
  down: "#e2704a",
};

function ln(value: string | LocalizedName, locale: Locale): string {
  return typeof value === "string" ? value : value[locale];
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const t = dict.portal;
  const statSubs: Record<string, string> = {
    statFarms: t.statFarmsSub, statBuyers: t.statBuyersSub, statProducts: t.statProductsSub,
    statDeals: t.statDealsSub, statCountries: t.statCountriesSub,
  };
  const statLabels: Record<string, string> = {
    statFarms: t.statFarms, statBuyers: t.statBuyers, statProducts: t.statProducts,
    statDeals: t.statDeals, statCountries: t.statCountries,
  };
  const features = [t.feature1, t.feature2, t.feature3, t.feature4, t.feature5];
  const services = [
    { title: t.svc1, desc: t.svc1Desc }, { title: t.svc2, desc: t.svc2Desc }, { title: t.svc3, desc: t.svc3Desc },
    { title: t.svc4, desc: t.svc4Desc }, { title: t.svc5, desc: t.svc5Desc },
  ];

  return (
    <div
      className="-my-8 py-10"
      style={{ marginInline: "calc(50% - 50vw)", paddingInline: "calc(50vw - 50%)", background: C.bg, color: C.text }}
    >
      <div className="space-y-10">
        {/* ===== Hero + 行情 ===== */}
        <section className="grid gap-8 lg:grid-cols-[1fr_400px]" id="insights">
          <div className="space-y-5 py-4">
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              {t.heroTitle1}
              <br />
              <span style={{ color: C.gold }}>{t.heroTitle2}</span>
            </h1>
            <p className="text-lg tracking-wide">{t.heroSlogan}</p>
            <p className="text-xs tracking-widest" style={{ color: C.muted }}>{t.heroCaption}</p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href={`/${locale}/market`} className="btn" style={{ background: C.gold, color: "#14100a" }}>
                {t.ctaMarket}
              </Link>
              <Link href={`/${locale}/register`} className="btn" style={{ border: `1px solid ${C.border}`, color: C.text }}>
                {t.ctaRfq}
              </Link>
              <Link href={`/${locale}/help`} className="btn" style={{ border: `1px solid ${C.border}`, color: C.gold }}>
                {dict.help.nav} ›
              </Link>
            </div>
          </div>
          <div className="rounded-lg border p-4" style={{ background: C.panel, borderColor: C.border }}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-medium">
                {t.insightsTitle} <span className="ml-1 text-[10px] tracking-widest" style={{ color: C.muted }}>{t.insightsTitleEn}</span>
              </h2>
              <Link href={`/${locale}/market`} className="text-xs" style={{ color: C.gold }}>{t.more} ›</Link>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: C.muted }}>
                  <th className="pb-2 text-left font-normal">{t.colSpecies}</th>
                  <th className="pb-2 text-left font-normal">{t.colSpec}</th>
                  <th className="pb-2 text-left font-normal">{t.colOrigin}</th>
                  <th className="pb-2 text-right font-normal">{t.colPrice}</th>
                  <th className="pb-2 text-right font-normal">{t.colTrend}</th>
                </tr>
              </thead>
              <tbody>
                {MARKET_INSIGHTS.rows.map((r) => (
                  <tr key={r.species} className="border-t" style={{ borderColor: C.border }}>
                    <td className="py-2 font-medium">{r.species}</td>
                    <td className="py-2" style={{ color: C.muted }}>{r.spec}</td>
                    <td className="py-2" style={{ color: C.muted }}>{ln(r.origin, locale)}</td>
                    <td className="py-2 text-right font-medium">€{r.price}</td>
                    <td className="py-2 text-right" style={{ color: r.trend >= 0 ? C.up : C.down }}>
                      {r.trend >= 0 ? "▲" : "▼"} {Math.abs(r.trend).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: C.border, color: C.muted }}>
              {t.updatedAt} {MARKET_INSIGHTS.updatedAt}
            </p>
          </div>
        </section>

        {/* ===== 平台数据带 ===== */}
        <section className="grid grid-cols-2 gap-3 rounded-lg border p-4 md:grid-cols-5" style={{ background: C.panelSoft, borderColor: C.border }}>
          {PLATFORM_STATS.map((s) => (
            <div key={s.key} className="px-2 py-1">
              <p className="text-xs" style={{ color: C.gold }}>{statLabels[s.key]}</p>
              <p className="text-2xl font-semibold">{s.value}</p>
              <p className="text-[11px]" style={{ color: C.muted }}>{statSubs[s.key]}</p>
            </div>
          ))}
        </section>

        {/* ===== 三栏：原产地 / 买家需求 / RFQ ===== */}
        <section className="grid gap-4 lg:grid-cols-3">
          {/* 原产地 */}
          <div id="origins" className="rounded-lg border p-4" style={{ background: C.panel, borderColor: C.border }}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-medium">
                {t.originsTitle} <span className="ml-1 text-[10px] tracking-widest" style={{ color: C.muted }}>{t.originsTitleEn}</span>
              </h2>
              <span className="text-xs" style={{ color: C.gold }}>{t.moreOrigins} ›</span>
            </div>
            <div className="space-y-3">
              {ORIGINS.map((o) => (
                <div key={o.name.en} className="flex gap-3 rounded-md border p-2.5" style={{ borderColor: C.border, background: C.panelSoft }}>
                  <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded" style={{ background: o.tone, color: C.gold }} aria-hidden>
                    ◉
                  </div>
                  <div className="min-w-0 text-xs leading-relaxed">
                    <p className="text-sm font-medium">{ln(o.name, locale)}</p>
                    <p style={{ color: C.muted }}>{t.mainSpecies}: {o.species}</p>
                    <p style={{ color: C.muted }}>{t.annualOutput}: {o.outputKg} kg</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t pt-3 text-[11px]" style={{ borderColor: C.border, color: C.muted }}>
              {features.map((f) => (
                <span key={f}>✓ {f}</span>
              ))}
            </div>
          </div>

          {/* 买家需求 */}
          <div id="buyers" className="rounded-lg border p-4" style={{ background: C.panel, borderColor: C.border }}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-medium">
                {t.demandTitle} <span className="ml-1 text-[10px] tracking-widest" style={{ color: C.muted }}>{t.demandTitleEn}</span>
              </h2>
              <span className="text-xs" style={{ color: C.gold }}>{t.moreDemand} ›</span>
            </div>
            <div className="space-y-3">
              {BUYER_DEMANDS.map((d) => (
                <div key={d.code} className="rounded-md border p-2.5 text-xs leading-relaxed" style={{ borderColor: C.border, background: C.panelSoft }}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-sm font-medium" style={{ color: C.gold }}>{d.code}</span>
                    <Link href={`/${locale}/register`} className="rounded border px-2 py-0.5" style={{ borderColor: C.border, color: C.text }}>
                      {t.viewDetail}
                    </Link>
                  </div>
                  <p style={{ color: C.muted }}>{ln(d.type, locale)}</p>
                  <p>
                    {t.needSpecies}: <span className="font-medium">{d.species}</span> · {t.needSpec}: {d.spec}
                  </p>
                  <p style={{ color: C.muted }}>
                    {t.needQty}: {d.qtyKg} kg · {t.deliveryBy}: {d.deliveryBy}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: C.border, color: C.muted }}>{t.anonymNote}</p>
          </div>

          {/* RFQ */}
          <div id="rfq" className="rounded-lg border p-4" style={{ background: C.panel, borderColor: C.border }}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-medium">
                {t.rfqTitle} <span className="ml-1 text-[10px] tracking-widest" style={{ color: C.muted }}>{t.rfqTitleEn}</span>
              </h2>
              <Link href={`/${locale}/register`} className="text-xs" style={{ color: C.gold }}>{t.publishRfq} ›</Link>
            </div>
            <div className="space-y-3">
              {RFQ_LIST.map((r) => (
                <div key={r.code} className="rounded-md border p-2.5 text-xs leading-relaxed" style={{ borderColor: C.border, background: C.panelSoft }}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono" style={{ color: C.muted }}>{r.code}</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={r.open ? { background: "#1d3a2a", color: C.up } : { background: "#3a2a1d", color: C.muted }}
                    >
                      {r.open ? t.statusOpen : t.statusClosed}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{ln(r.species, locale)} · {ln(r.spec, locale)}</p>
                  <p style={{ color: C.muted }}>
                    {t.rfqQty}: {r.qtyKg} kg · {t.rfqDeadline}: {r.deadline}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t pt-2 text-center text-xs" style={{ borderColor: C.border }}>
              <Link href={`/${locale}/register`} style={{ color: C.gold }}>{t.viewAllRfq} ›</Link>
            </p>
          </div>
        </section>

        {/* ===== 服务保障带 ===== */}
        <section className="grid grid-cols-1 gap-3 border-t pt-6 sm:grid-cols-2 lg:grid-cols-5" style={{ borderColor: C.border }}>
          {services.map((s) => (
            <div key={s.title} className="px-2 text-center lg:text-left">
              <p className="text-sm font-medium" style={{ color: C.gold }}>{s.title}</p>
              <p className="mt-1 text-xs" style={{ color: C.muted }}>{s.desc}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
