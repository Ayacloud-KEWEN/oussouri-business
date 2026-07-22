"use client";

import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Dictionary } from "@/lib/i18n";
import { api } from "@/lib/api";

interface CheckoutResult { paymentId: string; intentId: string; clientSecret?: string }

/** 真实卡支付表单（仅在配置了 publishable key 时挂载） */
function CardForm({ dict, onDone }: { dict: Dictionary; onDone: () => void }) {
  const t = dict.orderDetail;
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    // 不跳转第三方页面；需要 3DS 时 Stripe 会自行弹窗
    const { error: err } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    setBusy(false);
    if (err) setError(err.message ?? dict.common.error);
    else onDone();
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <PaymentElement />
      {error && <p className="text-sm" style={{ color: "var(--color-warning)" }}>{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={!stripe || busy}>
        {busy ? dict.common.loading : t.pay}
      </button>
    </form>
  );
}

/**
 * 收银台（R1-1）：
 * - 配置了 STRIPE_PUBLISHABLE_KEY → 真实 Stripe Elements 卡支付；
 * - 未配置（开发/演示）→ 回退模拟支付按钮，流程与真实一致（下单→托管→放款）。
 */
export function StripeCheckout({ orderCode, dict, onPaid }: { orderCode: string; dict: Dictionary; onPaid: () => void }) {
  const t = dict.orderDetail;
  const [pubKey, setPubKey] = useState<string | null | undefined>(undefined);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ publishableKey: string | null }>("GET", "/payments/config")
      .then((c) => setPubKey(c.publishableKey))
      .catch(() => setPubKey(null));
  }, []);

  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (pubKey ? loadStripe(pubKey) : null),
    [pubKey],
  );

  const startCheckout = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<CheckoutResult>("POST", "/payments/checkout", { orderCode });
      if (pubKey && res.clientSecret) {
        setClientSecret(res.clientSecret);
      } else {
        // 开发态：直接回调 webhook 模拟支付成功
        await api("POST", "/webhooks/stripe", { type: "payment_intent.succeeded", data: { object: { id: res.intentId } } });
        onPaid();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.common.error);
    } finally {
      setBusy(false);
    }
  };

  if (pubKey === undefined) return <p className="text-sm" style={{ color: "var(--color-muted)" }}>{dict.common.loading}</p>;

  if (clientSecret && stripePromise) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "night" } }}>
        <CardForm dict={dict} onDone={onPaid} />
      </Elements>
    );
  }

  return (
    <div className="space-y-2">
      <button className="btn btn-primary" onClick={startCheckout} disabled={busy}>
        {busy ? dict.common.loading : t.pay}
      </button>
      {!pubKey && <p className="text-xs" style={{ color: "var(--color-muted)" }}>{t.simulatedPayment}</p>}
      {error && <p className="text-sm" style={{ color: "var(--color-warning)" }}>{error}</p>}
    </div>
  );
}
