/* eslint-disable no-console */
/**
 * 清理开发库里的 smoke/测试残留数据。
 *
 * 背景：每跑一次 smoke 就新建一批组织、账号、产品、订单与证书，攒久了后台主体名录被淹没
 * （曾达 86 家，其中大半是 `X Supplier 1784712343359` 这类一次性主体），演示前很难看，
 * 前端还会因重名冒出 React 重复 key 警告。
 *
 * 判定标准见 lib/test-data.ts：组织名必须匹配 smoke 的命名模式**且以 13 位时间戳结尾**。
 * 真实主体（华芝宝 / 拓派 / 良美 / WELLHOPE / ZHOU LIHANG / JINGLIN / CHEN STEINKERQUE）
 * 与演示账号（demo-ops、supplier-a/b、buyer-a/b）都不会命中。
 *
 * 默认只预览，不删：
 *   npx tsx scripts/clean-test-data.ts            # 列出将被删除的主体
 *   npx tsx scripts/clean-test-data.ts --yes      # 真的删
 */
import { PrismaClient } from "@prisma/client";
import { findTestOrgs, purgeOrgs } from "./lib/test-data";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const execute = process.argv.includes("--yes");
  const orgs = await findTestOrgs(prisma);

  if (orgs.length === 0) {
    console.log("✅ 没有发现测试残留数据，库是干净的。");
    return;
  }

  const total = await prisma.organization.count();
  console.log(`发现 ${orgs.length} 个测试主体（全库共 ${total} 个）：\n`);
  for (const o of orgs.slice(0, 40)) console.log(`  ${o.publicCode}  ${o.legalName}`);
  if (orgs.length > 40) console.log(`  …… 另有 ${orgs.length - 40} 个`);

  if (!execute) {
    console.log(`\n这是预览。确认无误后加 --yes 执行：`);
    console.log(`  npx tsx scripts/clean-test-data.ts --yes`);
    return;
  }

  console.log(`\n开始清理（单事务，任一表漏删会整体回滚）……`);
  const report = await purgeOrgs(prisma, orgs.map((o) => o.id));
  const tables = Object.entries(report.rows).sort((a, b) => b[1] - a[1]);
  const rowTotal = tables.reduce((sum, [, n]) => sum + n, 0);

  console.log(`\n已删除 ${report.orgs} 个主体、${report.users} 个账号，合计 ${rowTotal} 行：`);
  for (const [table, count] of tables) console.log(`  ${String(count).padStart(6)}  ${table}`);
  console.log(`\n剩余主体：${await prisma.organization.count()} 个`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
