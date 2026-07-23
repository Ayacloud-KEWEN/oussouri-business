import { Prisma } from "@prisma/client";

/**
 * 账本不变量（资金底线）。
 *
 * 平台的钱只在这张表里说得清：买家付款、托管冻结、放款分账、退款、争议裁决全部落 LedgerEntry。
 * 单测和类型检查都盯不住"金额算错"这类问题 —— 分期付款那次事故（checkout 只认 PLACED
 * 导致尾款永远付不了）就是跑完整链路才暴露的。这里把"任意时刻账必须是平的"写成可执行的断言，
 * 既用于单测覆盖各条资金路径，也用于对整库做体检（scripts/check-ledger.ts）。
 *
 * 纯函数、不碰数据库，故可在单测里直接喂构造数据。
 */

export interface LedgerRow {
  journalId: string;
  account: string;
  direction: string;
  amount: Prisma.Decimal | string | number;
  currency: string;
  orderId?: string | null;
}

export interface Violation {
  /** 违反了哪条不变量 */
  rule: "JOURNAL_UNBALANCED" | "MIXED_CURRENCY" | "NON_POSITIVE_AMOUNT" | "ESCROW_OVERDRAWN";
  journalId?: string;
  orderId?: string | null;
  currency?: string;
  detail: string;
}

const dec = (v: Prisma.Decimal | string | number): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * 不变量 1：每笔日记账借贷相等。
 * 复式记账的根本 —— 一笔资金流动必须同时记录来源与去向，两边金额相等。
 */
export function checkJournalsBalanced(rows: LedgerRow[]): Violation[] {
  const violations: Violation[] = [];
  const journals = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const list = journals.get(r.journalId) ?? [];
    list.push(r);
    journals.set(r.journalId, list);
  }

  for (const [journalId, entries] of journals) {
    // 不变量 2：一笔日记账不得混币种 —— 混了之后借贷"看起来平"可能只是数字巧合
    const currencies = new Set(entries.map((e) => e.currency));
    if (currencies.size > 1) {
      violations.push({
        rule: "MIXED_CURRENCY",
        journalId,
        orderId: entries[0]?.orderId,
        detail: `同一笔日记账出现多种币种：${[...currencies].join(", ")}`,
      });
      continue; // 币种都混了，再算借贷差没有意义
    }

    const currency = entries[0]!.currency;
    let debit = new Prisma.Decimal(0);
    let credit = new Prisma.Decimal(0);
    for (const e of entries) {
      if (e.direction === "DEBIT") debit = debit.plus(dec(e.amount));
      else credit = credit.plus(dec(e.amount));
    }
    if (!debit.equals(credit)) {
      violations.push({
        rule: "JOURNAL_UNBALANCED",
        journalId,
        orderId: entries[0]?.orderId,
        currency,
        detail: `借 ${debit.toFixed(2)} ≠ 贷 ${credit.toFixed(2)} ${currency}（差额 ${debit.minus(credit).toFixed(2)}）`,
      });
    }
  }
  return violations;
}

/**
 * 不变量 3：金额恒为正。
 * 方向由 direction 表达；用负数记账会让借贷两侧都能"凑平"，等于绕开不变量 1。
 */
export function checkAmountsPositive(rows: LedgerRow[]): Violation[] {
  return rows
    .filter((r) => dec(r.amount).lte(0))
    .map((r) => ({
      rule: "NON_POSITIVE_AMOUNT" as const,
      journalId: r.journalId,
      orderId: r.orderId,
      currency: r.currency,
      detail: `${r.account} ${r.direction} 金额为 ${dec(r.amount).toFixed(2)}，必须大于 0`,
    }));
}

/**
 * 不变量 4：托管不透支。
 * 每个订单的 ESCROW_HELD 净额（贷 − 借）不得为负 —— 放出去的钱不能多于收进来的。
 * 这是最贵的一类 bug：算错就是平台自掏腰包给供应商打款。
 */
export function checkEscrowNotOverdrawn(rows: LedgerRow[]): Violation[] {
  const byOrder = new Map<string, { net: Prisma.Decimal; currency: string }>();
  for (const r of rows) {
    if (r.account !== "ESCROW_HELD" || !r.orderId) continue;
    const cur = byOrder.get(r.orderId) ?? { net: new Prisma.Decimal(0), currency: r.currency };
    cur.net = r.direction === "CREDIT" ? cur.net.plus(dec(r.amount)) : cur.net.minus(dec(r.amount));
    byOrder.set(r.orderId, cur);
  }
  const violations: Violation[] = [];
  for (const [orderId, { net, currency }] of byOrder) {
    if (net.lt(0)) {
      violations.push({
        rule: "ESCROW_OVERDRAWN",
        orderId,
        currency,
        detail: `托管净额 ${net.toFixed(2)} ${currency} 为负：放款/退款金额超过了实际收到的款项`,
      });
    }
  }
  return violations;
}

/** 全部不变量一次过 */
export function checkLedgerInvariants(rows: LedgerRow[]): Violation[] {
  return [
    ...checkJournalsBalanced(rows),
    ...checkAmountsPositive(rows),
    ...checkEscrowNotOverdrawn(rows),
  ];
}
