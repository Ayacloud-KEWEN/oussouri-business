export interface PaymentIntentResult {
  intentId: string;
  clientSecret: string;
}

export interface TransferResult {
  transferId: string;
}

/** 支付网关端口（架构 A6 / 决策 D2）：默认 Stripe Connect，可替换 */
export abstract class StripePort {
  abstract createPaymentIntent(amountMinor: number, currency: string, metadata: Record<string, string>): Promise<PaymentIntentResult>;
  abstract createTransfer(amountMinor: number, currency: string, destinationAccountId: string, metadata: Record<string, string>): Promise<TransferResult>;
  abstract verifyWebhook(rawBody: Buffer | string, signature: string): { type: string; data: unknown } | null;
}
