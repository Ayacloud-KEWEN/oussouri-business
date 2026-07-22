import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  StripePort, PaymentIntentResult, TransferResult,
  ConnectAccountResult, AccountLinkResult, ConnectAccountStatus,
} from "./stripe.port";

/**
 * 开发/测试用假适配器：STRIPE_SECRET_KEY 为占位值时启用，
 * 生成假 intent/transfer id，webhook 直接信任（仅限非生产）。
 */
@Injectable()
export class FakeStripeAdapter extends StripePort {
  private readonly logger = new Logger(FakeStripeAdapter.name);

  async createPaymentIntent(amountMinor: number, currency: string, metadata: Record<string, string>): Promise<PaymentIntentResult> {
    const id = `pi_fake_${randomBytes(8).toString("hex")}`;
    this.logger.log(`[FAKE] PaymentIntent ${id} ${amountMinor} ${currency} order=${metadata.orderCode ?? ""}`);
    return { intentId: id, clientSecret: `${id}_secret_fake` };
  }

  async createTransfer(amountMinor: number, currency: string, destinationAccountId: string): Promise<TransferResult> {
    const id = `tr_fake_${randomBytes(8).toString("hex")}`;
    this.logger.log(`[FAKE] Transfer ${id} ${amountMinor} ${currency} → ${destinationAccountId}`);
    return { transferId: id };
  }

  verifyWebhook(rawBody: Buffer | string): { type: string; data: unknown } | null {
    try {
      return JSON.parse(rawBody.toString()) as { type: string; data: unknown };
    } catch {
      return null;
    }
  }

  async createConnectAccount(input: { country: string; orgCode: string }): Promise<ConnectAccountResult> {
    const id = `acct_fake_${input.orgCode.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    this.logger.log(`[FAKE] Connect account ${id} (${input.country})`);
    return { accountId: id };
  }

  async createAccountLink(accountId: string, _refreshUrl: string, returnUrl: string): Promise<AccountLinkResult> {
    // 开发态直接回跳 returnUrl，前端流程与真实一致
    this.logger.log(`[FAKE] AccountLink for ${accountId}`);
    return { url: `${returnUrl}?fake_onboarding=1`, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  }

  async getAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
    // 假适配器视为已完成，便于开发环境走通放款
    return { accountId, payoutsEnabled: true, chargesEnabled: true, detailsSubmitted: true, requirementsDue: [] };
  }

  get publishableKey(): string | null {
    return null;
  }
}

/**
 * 真实 Stripe 适配器（REST，Separate Charges & Transfers）。
 * 生产启用前需配置 STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET 并通过 Stripe CLI 联调。
 */
@Injectable()
export class RestStripeAdapter extends StripePort {
  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly pubKey = "",
  ) {
    super();
  }

  private async call(path: string, params: Record<string, string>, method: "POST" | "GET" = "POST"): Promise<Record<string, unknown>> {
    const isGet = method === "GET";
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`https://api.stripe.com/v1/${path}${isGet && qs ? `?${qs}` : ""}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: isGet ? undefined : qs,
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = json.error as { message?: string } | undefined;
      throw new Error(`Stripe ${path} failed: ${err?.message ?? res.status}`);
    }
    return json;
  }

  async createPaymentIntent(amountMinor: number, currency: string, metadata: Record<string, string>): Promise<PaymentIntentResult> {
    const params: Record<string, string> = {
      amount: String(amountMinor),
      currency: currency.toLowerCase(),
      "automatic_payment_methods[enabled]": "true",
    };
    for (const [k, v] of Object.entries(metadata)) params[`metadata[${k}]`] = v;
    const intent = await this.call("payment_intents", params);
    return { intentId: intent.id as string, clientSecret: intent.client_secret as string };
  }

  async createTransfer(amountMinor: number, currency: string, destinationAccountId: string, metadata: Record<string, string>): Promise<TransferResult> {
    const params: Record<string, string> = {
      amount: String(amountMinor),
      currency: currency.toLowerCase(),
      destination: destinationAccountId,
    };
    for (const [k, v] of Object.entries(metadata)) params[`metadata[${k}]`] = v;
    const transfer = await this.call("transfers", params);
    return { transferId: transfer.id as string };
  }

  verifyWebhook(rawBody: Buffer | string, signature: string): { type: string; data: unknown } | null {
    // Stripe 签名: t=timestamp,v1=hmac_sha256(webhookSecret, `${t}.${payload}`)
    const { createHmac, timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
    const parts = Object.fromEntries(signature.split(",").map((p) => p.split("=") as [string, string]));
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return null;
    const expected = createHmac("sha256", this.webhookSecret).update(`${t}.${rawBody.toString()}`).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return JSON.parse(rawBody.toString()) as { type: string; data: unknown };
  }

  // ---- Connect（R1-2）：Express 账户，平台承担手续费与结算 ----

  async createConnectAccount(input: { country: string; email?: string; orgCode: string }): Promise<ConnectAccountResult> {
    const params: Record<string, string> = {
      type: "express",
      country: input.country.toUpperCase(),
      "capabilities[transfers][requested]": "true",
      "metadata[orgCode]": input.orgCode,
    };
    if (input.email) params.email = input.email;
    const account = await this.call("accounts", params);
    return { accountId: account.id as string };
  }

  async createAccountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<AccountLinkResult> {
    const link = await this.call("account_links", {
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    return { url: link.url as string, expiresAt: Number(link.expires_at ?? 0) };
  }

  async getAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
    const account = await this.call(`accounts/${accountId}`, {}, "GET");
    const requirements = (account.requirements ?? {}) as { currently_due?: string[] };
    return {
      accountId,
      payoutsEnabled: Boolean(account.payouts_enabled),
      chargesEnabled: Boolean(account.charges_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      requirementsDue: requirements.currently_due ?? [],
    };
  }

  get publishableKey(): string | null {
    return this.pubKey || null;
  }
}
