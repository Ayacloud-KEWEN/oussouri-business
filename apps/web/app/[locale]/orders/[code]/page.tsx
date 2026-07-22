"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { api } from "@/lib/api";
import { TemperatureChart } from "@/components/temperature-chart";

interface OrderItem { qty: string; unitPrice: string; lineTotal: string; snapshot: { productName?: string; skuCode?: string; packSpec?: string } }
interface Payment { method: string; amount: string; currency: string; status: string; paidAt: string | null; createdAt: string }
interface Declaration { direction: string; declarationNo: string | null; brokerName: string | null; status: string; declaredAt: string | null; clearedAt: string | null; inspectionResult: string | null }
interface DocRow { docType: string; docNo: string | null; issuer: string | null; issueDate: string | null; expiryDate: string | null; status: string }
interface TimelineRow { action: string; at: string; actorRole: string | null; to: string | null }
interface OrderDetail {
  code: string; status: string; orderType: string; side: string;
  counterpartyCode: string; counterpartyCountry: string | null;
  currency: string; itemsTotal: string; grandTotal: string; commissionAmount?: string;
  incoterms: string | null; notes: string | null;
  placedAt: string | null; completedAt: string | null; disputeUntil: string | null;
  items: OrderItem[]; payments: Payment[]; declarations: Declaration[]; documents: DocRow[]; timeline: TimelineRow[];
}
interface Leg { seq: number; mode: string; carrier: string; waybillNo: string | null; fromCode: string; toCode: string; status: string; departAt: string | null; arriveAt: string | null }
interface TempRow { recordedAt: string; tempC: string; breached: boolean; source: string }
interface Shipment {
  status: string; incoterms: string | null; packages: number | null; grossWeightKg: string | null;
  legs: Leg[]; temperatures: TempRow[]; temperatureBreaches: number;
}
interface Checklist { required: string[]; present: string[]; missing: string[]; complete: boolean }

const d10 = (v: string | null) => (v ? v.slice(0, 10) : "—");

function Panel({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium" style={{ color: "var(--color-accent)" }}>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = use(params);
  const dict = getDictionary(locale);
  const t = dict.orderDetail;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const o = await api<OrderDetail>("GET", `/orders/${code}`);
      setOrder(o);
      // 运单与齐备度可能尚未建立，失败不阻断页面
      const [s, c] = await Promise.all([
        api<Shipment | null>("GET", `/orders/${code}/shipment`).catch(() => null),
        api<Checklist>("GET", `/orders/${code}/doc-checklist`).catch(() => null),
      ]);
      setShipment(s);
      setChecklist(c);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
    } finally {
      setLoading(false);
    }
  }, [code, dict.common.error]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await fn();
      await refresh();
      setMessage(dict.common.success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : dict.common.error);
    }
  };

  if (loading) return <p className="text-sm" style={{ color: "var(--color-muted)" }}>{dict.common.loading}</p>;
  if (!order) return <p className="text-sm">{message ?? dict.common.error}</p>;

  const isBuyer = order.side === "BUYER";
  const backHref = isBuyer ? `/${locale}/buyer` : order.side === "SUPPLIER" ? `/${locale}/supplier` : `/${locale}/admin`;

  return (
    <div className="space-y-6">
      <p className="text-xs">
        <Link href={backHref} style={{ color: "var(--color-accent)" }}>‹ {t.back}</Link>
      </p>

      {/* 头部：编号 / 状态 / 金额 */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-semibold">{order.code}</h1>
        <span className="badge">{order.status}</span>
        <span className="badge">{isBuyer ? t.supplierSide : t.buyerSide}: {order.counterpartyCode}</span>
        {order.incoterms && <span className="badge">{order.incoterms}</span>}
        <span className="ml-auto text-lg font-semibold">{order.currency} {order.grandTotal}</span>
      </div>
      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 商品明细 */}
        <Panel title={t.items}>
          <table className="w-full text-sm">
            <tbody>
              {order.items.map((i, idx) => (
                <tr key={idx} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="py-1.5">
                    {i.snapshot?.productName ?? i.snapshot?.skuCode ?? "—"}
                    {i.snapshot?.packSpec && <span style={{ color: "var(--color-muted)" }}> · {i.snapshot.packSpec}</span>}
                  </td>
                  <td className="py-1.5 text-right" style={{ color: "var(--color-muted)" }}>{i.qty} × {i.unitPrice}</td>
                  <td className="py-1.5 pl-3 text-right font-medium">{i.lineTotal}</td>
                </tr>
              ))}
              <tr className="border-t" style={{ borderColor: "var(--color-border)" }}>
                <td className="py-1.5 font-medium" colSpan={2}>{t.itemsTotal}</td>
                <td className="py-1.5 text-right font-medium">{order.currency} {order.itemsTotal}</td>
              </tr>
              {order.commissionAmount != null && (
                <tr>
                  <td className="py-1.5" colSpan={2} style={{ color: "var(--color-muted)" }}>{t.commission}</td>
                  <td className="py-1.5 text-right" style={{ color: "var(--color-muted)" }}>−{order.commissionAmount}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            {t.placedAt}: {d10(order.placedAt)}{order.completedAt ? ` · ${t.completedAt}: ${d10(order.completedAt)}` : ""}
          </p>
          {order.notes && (
            <p className="rounded-md p-2 text-xs leading-relaxed" style={{ background: "var(--color-accent-soft)" }}>{order.notes}</p>
          )}
        </Panel>

        {/* 资金 */}
        <Panel title={t.payments}>
          {order.payments.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.noPayment}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {order.payments.map((p, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="py-1.5">{p.method}</td>
                    <td className="py-1.5" style={{ color: "var(--color-muted)" }}>{p.status}</td>
                    <td className="py-1.5" style={{ color: "var(--color-muted)" }}>{d10(p.paidAt ?? p.createdAt)}</td>
                    <td className="py-1.5 text-right font-medium">{p.currency} {p.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>💡 {t.escrowNote}</p>
          {isBuyer && order.status === "PLACED" && (
            <button
              className="btn btn-primary"
              onClick={() => act(async () => {
                const checkout = await api<{ intentId: string }>("POST", "/payments/checkout", { orderCode: order.code });
                await api("POST", "/webhooks/stripe", { type: "payment_intent.succeeded", data: { object: { id: checkout.intentId } } });
              })}
            >
              {t.pay}
            </button>
          )}
          {isBuyer && ["SHIPPED", "CUSTOMS_CLEARED", "IN_CUSTOMS"].includes(order.status) && (
            <button className="btn btn-primary" onClick={() => act(() => api("POST", `/buyer/orders/${order.code}/confirm-delivery`, {}))}>
              {t.confirmDelivery}
            </button>
          )}
        </Panel>

        {/* 单证 */}
        <Panel
          title={t.documents}
          extra={checklist && (
            // 分母是合同必需单证数；已登记的参考件不计入，避免出现 11/7 这种读起来奇怪的比值
            <span className="badge" style={checklist.complete ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" } : undefined}>
              {checklist.required.length - checklist.missing.length}/{checklist.required.length} {checklist.complete ? t.complete : t.incomplete}
            </span>
          )}
        >
          {order.documents.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.noDocs}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {order.documents.map((doc, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="py-1.5 font-medium">{doc.docType}</td>
                    <td className="py-1.5 font-mono text-xs" style={{ color: "var(--color-muted)" }}>{doc.docNo ?? "—"}</td>
                    <td className="py-1.5 text-right text-xs" style={{ color: "var(--color-muted)" }}>{d10(doc.issueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {checklist && checklist.missing.length > 0 && (
            <p className="text-xs" style={{ color: "var(--color-warning)" }}>
              ⚠ {t.missing}: {checklist.missing.join(", ")}
            </p>
          )}
        </Panel>

        {/* 报关 */}
        <Panel title={t.customs}>
          {order.declarations.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.noCustoms}</p>
          ) : (
            <div className="space-y-2">
              {order.declarations.map((dec, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 border-t pt-2 text-sm" style={{ borderColor: "var(--color-border)" }}>
                  <span className="badge">{dec.direction === "EXPORT" ? t.export : t.import}</span>
                  <span className="badge">{dec.status}</span>
                  {dec.declarationNo && <span className="font-mono text-xs" style={{ color: "var(--color-muted)" }}>{dec.declarationNo}</span>}
                  {dec.brokerName && <span className="text-xs" style={{ color: "var(--color-muted)" }}>{dec.brokerName}</span>}
                  {dec.clearedAt && <span className="ml-auto text-xs" style={{ color: "var(--color-muted)" }}>{t.clearedAt} {d10(dec.clearedAt)}</span>}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* 物流与冷链 */}
      <Panel
        title={t.logistics}
        extra={shipment && shipment.temperatureBreaches > 0 && (
          <span className="badge" style={{ color: "var(--color-warning)" }}>⚠ {t.breaches}: {shipment.temperatureBreaches}</span>
        )}
      >
        {!shipment ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t.noShipment}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              {shipment.status}
              {shipment.packages ? ` · ${shipment.packages} ${t.packages}` : ""}
              {shipment.grossWeightKg ? ` · ${t.grossWeight} ${shipment.grossWeightKg} kg` : ""}
            </p>
            <ol className="space-y-2">
              {shipment.legs.map((leg) => (
                <li key={leg.seq} className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm" style={{ background: "var(--color-accent-soft)" }}>
                  <span className="font-medium">{leg.fromCode} → {leg.toCode}</span>
                  <span className="badge">{leg.mode}</span>
                  <span style={{ color: "var(--color-muted)" }}>{leg.carrier}</span>
                  {leg.waybillNo && <span className="font-mono text-xs" style={{ color: "var(--color-muted)" }}>{leg.waybillNo}</span>}
                  <span className="ml-auto text-xs" style={{ color: "var(--color-muted)" }}>
                    {d10(leg.departAt)} → {d10(leg.arriveAt)}
                  </span>
                </li>
              ))}
            </ol>
            {shipment.temperatures.length > 0 && (
              <TemperatureChart data={shipment.temperatures} title={t.coldChain} unitLabel={t.tempUnit} />
            )}
          </div>
        )}
      </Panel>

      {/* 状态时间线 */}
      {order.timeline.length > 0 && (
        <Panel title={t.timeline}>
          <ol className="space-y-1.5 text-sm">
            {order.timeline.map((row, i) => (
              <li key={i} className="flex flex-wrap gap-2">
                <span style={{ color: "var(--color-accent)" }}>●</span>
                <span className="font-medium">{row.to ?? row.action}</span>
                <span style={{ color: "var(--color-muted)" }}>{row.at.slice(0, 16).replace("T", " ")}</span>
                {/* 多角色账号（如运营主控）只显示首个角色，避免一行铺满 */}
                {row.actorRole && <span className="text-xs" style={{ color: "var(--color-muted)" }}>{row.actorRole.split(",")[0]}</span>}
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}
