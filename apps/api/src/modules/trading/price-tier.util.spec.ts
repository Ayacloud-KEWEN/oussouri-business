import { Prisma } from "@prisma/client";
import { pickPriceTier } from "./price-tier.util";

const D = (n: number | string) => new Prisma.Decimal(n);

describe("pickPriceTier（初稿 §6.4 阶梯价语义）", () => {
  // 示例：50kg 以下 €800，50-200kg €750，200kg 以上 €700
  const tiers = [
    { qtyMin: D(0), qtyMax: D(50), unitPrice: D(800) },
    { qtyMin: D(50), qtyMax: D(200), unitPrice: D(750) },
    { qtyMin: D(200), qtyMax: null, unitPrice: D(700) },
  ];

  it.each([
    [10, 800],
    [49.99, 800],
    [50, 750], // 边界：左闭右开，50 命中第二档（Step 7 冒烟修复的回归）
    [199.99, 750],
    [200, 700],
    [10000, 700],
  ])("%skg → €%s", (qty, price) => {
    expect(pickPriceTier(tiers, D(qty))?.unitPrice.toNumber()).toBe(price);
  });

  it("低于最小档返回 undefined", () => {
    const gapped = [{ qtyMin: D(10), qtyMax: null, unitPrice: D(100) }];
    expect(pickPriceTier(gapped, D(5))).toBeUndefined();
  });

  it("空档位返回 undefined", () => {
    expect(pickPriceTier([], D(50))).toBeUndefined();
  });
});
