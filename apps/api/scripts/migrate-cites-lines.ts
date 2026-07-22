/* eslint-disable no-console */
/**
 * CITES 结构迁移（R1.5-3）：把此前因"一条记录一个物种"限制而拆分的证书合并回真实形态。
 *
 * 背景：真实证书 2025CN/EC00017/HBB 含杂交鲟 25kg + 施氏鲟 25kg，
 * 导入时被迫拆成 `.../DAUxSCH` 与 `.../SCH` 两条带后缀记录。现合并为一证两物种行。
 *
 * 处理规则：
 *  - permitNo 形如 `<真实证号>/<后缀>` 且同前缀有多条 → 合并为一条，各自成为物种行；
 *  - 其余单物种证 → 原地补建一条同值物种行（保证所有证都有 lines）。
 * 幂等：已有 lines 的证跳过。
 *
 *   npx tsx scripts/migrate-cites-lines.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const permits = await prisma.citesPermit.findMany({
    where: { deletedAt: null },
    include: { lines: true },
    orderBy: { permitNo: "asc" },
  });
  console.log(`共 ${permits.length} 张证`);

  // 按"真实证号"分组：去掉最后一段后缀（仅当剩余部分仍像证号，即含 '/'）
  const groups = new Map<string, typeof permits>();
  for (const p of permits) {
    const parts = p.permitNo.split("/");
    // 形如 2025CN/EC00017/HBB/DAUxSCH → 前 3 段是真实证号
    const base = parts.length >= 4 ? parts.slice(0, 3).join("/") : p.permitNo;
    const list = groups.get(base) ?? [];
    list.push(p);
    groups.set(base, list);
  }

  let merged = 0;
  let backfilled = 0;

  for (const [base, list] of groups) {
    if (list.length > 1) {
      // 合并：保留最早创建的一条作为主记录，改名为真实证号
      const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const primary = sorted[0]!;
      const others = sorted.slice(1);
      const totalQuota = sorted.reduce((s, p) => s.plus(p.quotaKg), new Prisma.Decimal(0));
      const totalUsed = sorted.reduce((s, p) => s.plus(p.usedKg), new Prisma.Decimal(0));

      await prisma.$transaction(async (tx) => {
        for (const p of sorted) {
          const already = await tx.citesPermitLine.findFirst({ where: { permitId: primary.id, speciesCode: p.speciesCode } });
          if (!already) {
            await tx.citesPermitLine.create({
              data: { permitId: primary.id, speciesCode: p.speciesCode, quotaKg: p.quotaKg, usedKg: p.usedKg },
            });
          }
        }
        await tx.citesPermit.update({
          where: { id: primary.id },
          data: { permitNo: base, quotaKg: totalQuota, usedKg: totalUsed, version: { increment: 1 } },
        });
        // 被合并的记录软删，历史可查
        for (const p of others) {
          await tx.citesPermit.update({ where: { id: p.id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
        }
      });
      merged += 1;
      console.log(`  合并 ${base}：${sorted.length} 条 → 1 证 ${sorted.length} 物种行（${totalUsed}/${totalQuota} kg）`);
    } else {
      const p = list[0]!;
      if (p.lines.length === 0) {
        await prisma.citesPermitLine.create({
          data: { permitId: p.id, speciesCode: p.speciesCode, quotaKg: p.quotaKg, usedKg: p.usedKg },
        });
        backfilled += 1;
      }
    }
  }

  console.log(`\n✅ 完成：合并 ${merged} 组，补建物种行 ${backfilled} 条`);
  const after = await prisma.citesPermit.findMany({
    where: { deletedAt: null },
    include: { lines: { where: { deletedAt: null } } },
    orderBy: { permitNo: "asc" },
  });
  for (const p of after) {
    console.log(`  ${p.permitNo} [${p.status}] ${p.usedKg}/${p.quotaKg}kg → ${p.lines.map((l) => `${l.speciesCode} ${l.usedKg}/${l.quotaKg}`).join(" | ")}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
