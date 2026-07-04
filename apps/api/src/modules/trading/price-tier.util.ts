import { Prisma } from "@prisma/client";

export interface TierLike {
  qtyMin: Prisma.Decimal;
  qtyMax: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal;
}

/**
 * 阶梯价选择：区间左闭右开 [qtyMin, qtyMax)，qtyMax 为空表示无上限。
 * 初稿 §6.4 语义：50kg 命中 "50 及以上" 档。
 */
export function pickPriceTier<T extends TierLike>(tiers: T[], qty: Prisma.Decimal): T | undefined {
  return tiers.find((t) => qty.gte(t.qtyMin) && (t.qtyMax == null || qty.lt(t.qtyMax)));
}
