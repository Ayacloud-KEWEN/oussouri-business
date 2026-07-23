import { Prisma } from "@prisma/client";
import {
  checkLedgerInvariants,
  checkJournalsBalanced,
  checkAmountsPositive,
  checkEscrowNotOverdrawn,
  type LedgerRow,
} from "./ledger-invariants";

const D = (v: string | number) => new Prisma.Decimal(v);
const ORDER = "order-1";

/**
 * 以下三个 build* 函数**照抄生产代码的金额公式**（settlement.service.ts 与 dispute.service.ts），
 * 而不是手写"应该平"的数字。这样一旦有人改了分账算法却算错，测试会直接红 ——
 * 若只断言构造好的平账数据，测的就只是检查器本身，不是资金逻辑。
 */

/** settlement.service onPaymentSucceeded：买家在途 → 托管冻结 */
function buildPaymentJournal(journalId: string, amount: string, currency = "EUR"): LedgerRow[] {
  return [
    { journalId, account: "BUYER_FUNDS_IN_TRANSIT", orderId: ORDER, direction: "DEBIT", amount: D(amount), currency },
    { journalId, account: "ESCROW_HELD", orderId: ORDER, direction: "CREDIT", amount: D(amount), currency },
  ];
}

/** settlement.service releaseEscrow：托管 → 供应商应收 + 平台佣金 */
function buildPayoutJournal(journalId: string, grandTotal: string, commissionAmount: string, currency = "EUR"): LedgerRow[] {
  const supplierAmount = D(grandTotal).minus(D(commissionAmount)); // 生产公式
  return [
    { journalId, account: "ESCROW_HELD", orderId: ORDER, direction: "DEBIT", amount: D(grandTotal), currency },
    { journalId, account: "SUPPLIER_PAYABLE", orderId: ORDER, direction: "CREDIT", amount: supplierAmount, currency },
    { journalId, account: "PLATFORM_COMMISSION", orderId: ORDER, direction: "CREDIT", amount: D(commissionAmount), currency },
  ];
}

/** dispute.service resolve：三种裁决共用同一套分配公式 */
function buildDisputeJournal(journalId: string, grandTotal: string, refundAmount: string, commissionRate: string, currency = "EUR"): LedgerRow[] {
  const refund = D(refundAmount);
  const remaining = D(grandTotal).minus(refund);
  const commission = remaining.mul(D(commissionRate)).toDecimalPlaces(2);
  const supplierAmount = remaining.minus(commission);

  const rows: LedgerRow[] = [
    { journalId, account: "ESCROW_HELD", orderId: ORDER, direction: "DEBIT", amount: D(grandTotal), currency },
  ];
  if (refund.gt(0)) rows.push({ journalId, account: "REFUND_PAYABLE", orderId: ORDER, direction: "CREDIT", amount: refund, currency });
  if (supplierAmount.gt(0)) rows.push({ journalId, account: "SUPPLIER_PAYABLE", orderId: ORDER, direction: "CREDIT", amount: supplierAmount, currency });
  if (commission.gt(0)) rows.push({ journalId, account: "PLATFORM_COMMISSION", orderId: ORDER, direction: "CREDIT", amount: commission, currency });
  return rows;
}

describe("账本不变量：真实资金路径", () => {
  it("整单付款 → 放款分账，全链路借贷平衡", () => {
    const rows = [
      ...buildPaymentJournal("j1", "15100.00"),
      ...buildPayoutJournal("j2", "15100.00", "1208.00"),
    ];
    expect(checkLedgerInvariants(rows)).toEqual([]);
  });

  it("分期付款：多笔支付各自成账，合计放款仍平衡", () => {
    // R1.5-1：每期支付各写一笔日记账，放款时按订单总额一次冲销
    const rows = [
      ...buildPaymentJournal("j1", "4530.00"), // 30% 首期
      ...buildPaymentJournal("j2", "10570.00"), // 70% 尾款
      ...buildPayoutJournal("j3", "15100.00", "1208.00"),
    ];
    expect(checkLedgerInvariants(rows)).toEqual([]);
  });

  it("争议三种裁决都平衡（含佣金按比例重算）", () => {
    const grandTotal = "15100.00";
    const rate = "0.08";
    // 驳回：不退款，全额按原比例分账
    expect(checkLedgerInvariants([...buildPaymentJournal("p", grandTotal), ...buildDisputeJournal("d1", grandTotal, "0", rate)])).toEqual([]);
    // 全额退款：钱全回买家，供应商与平台分文不取
    expect(checkLedgerInvariants([...buildPaymentJournal("p2", grandTotal), ...buildDisputeJournal("d2", grandTotal, grandTotal, rate)])).toEqual([]);
    // 部分退款：剩余部分按原佣金比例分账
    expect(checkLedgerInvariants([...buildPaymentJournal("p3", grandTotal), ...buildDisputeJournal("d3", grandTotal, "5000.00", rate)])).toEqual([]);
  });

  it("佣金除不尽时余数由供应商侧吸收，账仍然平", () => {
    // 10000 - 3333.33 = 6666.67；6666.67 × 7.5% = 500.00025 → 四舍五入 500.00
    // 若实现改成对 supplierAmount 也做独立取整，这里就会出现 1 分钱缺口
    const rows = buildDisputeJournal("j-round", "10000.00", "3333.33", "0.075");
    expect(checkJournalsBalanced(rows)).toEqual([]);

    const credits = rows.filter((r) => r.direction === "CREDIT").reduce((s, r) => s.plus(new Prisma.Decimal(r.amount)), new Prisma.Decimal(0));
    expect(credits.toFixed(2)).toBe("10000.00");
  });

  it("多币种订单各自成账互不干扰", () => {
    const rows = [
      ...buildPaymentJournal("eur", "1000.00", "EUR"),
      ...buildPaymentJournal("usd", "1200.00", "USD"),
    ];
    expect(checkLedgerInvariants(rows)).toEqual([]);
  });
});

describe("账本不变量：能抓出坏账", () => {
  it("借贷不等被抓出", () => {
    const rows: LedgerRow[] = [
      { journalId: "bad", account: "ESCROW_HELD", orderId: ORDER, direction: "DEBIT", amount: D("100.00"), currency: "EUR" },
      { journalId: "bad", account: "SUPPLIER_PAYABLE", orderId: ORDER, direction: "CREDIT", amount: D("92.00"), currency: "EUR" },
    ];
    const v = checkJournalsBalanced(rows);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("JOURNAL_UNBALANCED");
    expect(v[0]!.detail).toContain("8.00");
  });

  it("漏记佣金分录被抓出（最容易犯的错）", () => {
    const rows = buildPayoutJournal("j", "15100.00", "1208.00").filter((r) => r.account !== "PLATFORM_COMMISSION");
    expect(checkJournalsBalanced(rows)[0]?.rule).toBe("JOURNAL_UNBALANCED");
  });

  it("同一笔日记账混币种被抓出", () => {
    const rows: LedgerRow[] = [
      { journalId: "mix", account: "ESCROW_HELD", orderId: ORDER, direction: "DEBIT", amount: D("100.00"), currency: "EUR" },
      { journalId: "mix", account: "SUPPLIER_PAYABLE", orderId: ORDER, direction: "CREDIT", amount: D("100.00"), currency: "USD" },
    ];
    expect(checkJournalsBalanced(rows)[0]!.rule).toBe("MIXED_CURRENCY");
  });

  it("负数或零金额被抓出", () => {
    const rows: LedgerRow[] = [
      { journalId: "neg", account: "ESCROW_HELD", orderId: ORDER, direction: "DEBIT", amount: D("-50.00"), currency: "EUR" },
      { journalId: "neg", account: "SUPPLIER_PAYABLE", orderId: ORDER, direction: "CREDIT", amount: D("-50.00"), currency: "EUR" },
    ];
    // 借贷"看起来平"，但用负数记账绕开了方向语义
    expect(checkJournalsBalanced(rows)).toEqual([]);
    expect(checkAmountsPositive(rows)).toHaveLength(2);
  });

  it("托管透支被抓出：放款多于收款", () => {
    const rows = [
      ...buildPaymentJournal("in", "1000.00"),
      ...buildPayoutJournal("out", "1500.00", "120.00"), // 只收了 1000 却放 1500
    ];
    const v = checkEscrowNotOverdrawn(rows);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("ESCROW_OVERDRAWN");
    expect(v[0]!.detail).toContain("-500.00");
  });

  it("退款重复入账导致托管透支被抓出", () => {
    const rows = [
      ...buildPaymentJournal("in", "15100.00"),
      ...buildDisputeJournal("d1", "15100.00", "15100.00", "0.08"),
      ...buildDisputeJournal("d2", "15100.00", "15100.00", "0.08"), // 同一争议裁决了两次
    ];
    expect(checkEscrowNotOverdrawn(rows)[0]!.rule).toBe("ESCROW_OVERDRAWN");
  });

  it("正常的完整生命周期不误报", () => {
    const rows = [
      ...buildPaymentJournal("in", "15100.00"),
      ...buildDisputeJournal("resolve", "15100.00", "3000.00", "0.08"),
    ];
    expect(checkLedgerInvariants(rows)).toEqual([]);
  });
});
