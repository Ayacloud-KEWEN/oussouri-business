/* eslint-disable no-console */
/**
 * 账本体检：把不变量跑在**整库真实数据**上。
 *
 * 单测覆盖的是公式，这个脚本覆盖的是历史累积 —— 早期版本写坏的账、并发下重复入账、
 * 人工改库留下的痕迹，都只有对着真库扫一遍才看得见。
 * 建议每次动资金流之后、以及上线前各跑一次。
 *
 *   npx tsx scripts/check-ledger.ts
 *
 * 退出码非 0 表示发现问题，便于将来挂进 CI。
 */
import { PrismaClient } from "@prisma/client";
import { checkLedgerInvariants } from "../src/modules/settlement/ledger-invariants";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.ledgerEntry.findMany({
    select: { journalId: true, account: true, direction: true, amount: true, currency: true, orderId: true },
  });

  if (rows.length === 0) {
    console.log("账本为空，无需体检。");
    return;
  }

  const journals = new Set(rows.map((r) => r.journalId)).size;
  console.log(`体检范围：${rows.length} 条分录 / ${journals} 笔日记账\n`);

  const violations = checkLedgerInvariants(rows);
  if (violations.length === 0) {
    // 顺带报一下各账户余额，方便肉眼核对量级是否合理
    const balances = new Map<string, { debit: number; credit: number; currency: string }>();
    for (const r of rows) {
      const key = `${r.account}/${r.currency}`;
      const b = balances.get(key) ?? { debit: 0, credit: 0, currency: r.currency };
      if (r.direction === "DEBIT") b.debit += Number(r.amount);
      else b.credit += Number(r.amount);
      balances.set(key, b);
    }
    console.log("各账户净额（贷 − 借）：");
    for (const [key, b] of [...balances].sort()) {
      console.log(`  ${key.padEnd(32)} ${(b.credit - b.debit).toFixed(2)}`);
    }
    console.log("\n✅ 账本不变量全部通过：每笔日记账借贷相等、无混币种、金额恒正、托管未透支。");
    return;
  }

  console.error(`❌ 发现 ${violations.length} 处违规：\n`);
  const byRule = new Map<string, typeof violations>();
  for (const v of violations) {
    byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
  }
  for (const [rule, list] of byRule) {
    console.error(`【${rule}】${list.length} 处`);
    for (const v of list.slice(0, 10)) {
      console.error(`  journal=${v.journalId ?? "-"} order=${v.orderId ?? "-"}  ${v.detail}`);
    }
    if (list.length > 10) console.error(`  …… 另有 ${list.length - 10} 处`);
    console.error("");
  }
  process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
