export interface PaymentIntentResult {
  intentId: string;
  clientSecret: string;
}

export interface TransferResult {
  transferId: string;
}

export interface ConnectAccountResult {
  accountId: string;
}

export interface AccountLinkResult {
  /** 供应商跳转完成 KYC 的一次性链接 */
  url: string;
  expiresAt: number;
}

export interface ConnectAccountStatus {
  accountId: string;
  /** 可接收转账（KYC 通过且未受限） */
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  /** Stripe 要求补充的材料项 */
  requirementsDue: string[];
}

/** 支付网关端口（架构 A6 / 决策 D2）：默认 Stripe Connect，可替换 */
export abstract class StripePort {
  abstract createPaymentIntent(amountMinor: number, currency: string, metadata: Record<string, string>): Promise<PaymentIntentResult>;
  abstract createTransfer(amountMinor: number, currency: string, destinationAccountId: string, metadata: Record<string, string>): Promise<TransferResult>;
  abstract verifyWebhook(rawBody: Buffer | string, signature: string): { type: string; data: unknown } | null;
  // ---- Connect 入驻（R1-2）----
  abstract createConnectAccount(input: { country: string; email?: string; orgCode: string }): Promise<ConnectAccountResult>;
  abstract createAccountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<AccountLinkResult>;
  abstract getAccountStatus(accountId: string): Promise<ConnectAccountStatus>;
  /** 前端 Elements 用的可公开密钥；假适配器返回 null（前端据此回退模拟支付） */
  abstract get publishableKey(): string | null;
}
