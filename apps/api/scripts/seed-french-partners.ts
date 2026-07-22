/* eslint-disable no-console */
/**
 * 法国业务伙伴档案导入（源：HZB/法国经销商.docx，2026-07-22）
 *
 * 与 seed-hzb-case / seed-tuopai / seed-liangmei 的差别：那三份导入的是**中国供应商**与平台主线交易；
 * 本文件记录的是**法国经销商 JINGLIN 自身的下游零售业务**（卖方 WELLHOPE / ZHOU LIHANG 个人 / SAS JINGLIN
 * PARIS，买方为巴黎终端客户）。平台没有「经销商下游分销」这一层，其 TradeOrder 挂的是佣金/托管/报关/CITES，
 * 这四项在这些零售单里全部不适用。
 *
 * 因此本脚本**只建主体档案，不建订单/发票/支付**：
 *   1. SAS JINGLIN PARIS —— 平台已有买家主体，此处仅**补齐**法定信息（VAT / RCS / 注册地址）与业务沿革
 *   2. WELLHOPE          —— 新建供应商档案（法国本地，JINGLIN 的前身或关联公司）
 *   3. ZHOU LIHANG（个人）—— 新建历史主体档案，标记为已停用、建议并入 JINGLIN
 *   4. CHEN STEINKERQUE  —— 新建客户档案
 *   5. JINGLIN 客户编码 001 —— 新建客户档案（公司全称待补）
 * 四笔历史销售（FR-001 / FA000007 / FA000008 / FA000010）与对应发票**只写进内部备注**作为业务沿革参考，
 * 不进 TradeOrder，避免污染平台 GMV / 佣金 / 托管统计。
 *
 * 数据合规（GBR-1 身份防火墙 + PII 规范）：
 *   - 文档中的两个 IBAN（ZHOU LIHANG 个人账户、JINGLIN 的 Wise 账户）**一律不入库** ——
 *     平台收款走 Stripe Connect，没有银行账号字段，明文落 notes 会让任何能读组织备注的角色看到完整收款账号。
 *   - 自然人姓名 / 地址 / 电话 / 邮箱走平台既有的加密列 + 盲索引，与其他真实数据一致。
 *
 * 新建主体状态一律 INACTIVE：档案已存在但尚未作为平台主体启用，
 * 这样既不占用 PENDING 入驻审核队列（party.service 默认队列按 PENDING 过滤），也不会被当成活跃交易方。
 *
 * 可重复执行（幂等，按 legalName 盲索引判重）。前提：PG 已启动（不依赖 API）。
 *   npx tsx scripts/seed-french-partners.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { createCipheriv, createHmac, randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

// ---------- helpers（与其他 seed 脚本一致） ----------
function envVal(key: string): string {
  if (process.env[key]) return process.env[key]!;
  const file = resolve(__dirname, "..", ".env");
  if (existsSync(file)) {
    const m = readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    if (m) return m[1]!.replace(/^"|"$/g, "");
  }
  throw new Error(`missing env ${key}`);
}
const bidx = (v: string) => createHmac("sha256", Buffer.from(envVal("PII_BLIND_INDEX_KEY"), "hex")).update(v.trim().toLowerCase()).digest("hex");
function encrypt(v: string): Uint8Array {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(envVal("PII_ENCRYPTION_KEY"), "hex"), iv);
  const enc = Buffer.concat([c.update(v, "utf8"), c.final()]);
  const packed = Buffer.concat([iv, c.getAuthTag(), enc]);
  const out = new Uint8Array(packed.length); out.set(packed); return out;
}

/** 复刻 CodeGeneratorService.next（行锁递增 + 随机跳步），脚本不经 API 也能拿到规范编码 */
async function nextCode(entityType: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; prefix: string; pattern: string; seqLength: number; jumpMax: number; currentSeq: bigint }[]>`
      SELECT id, prefix, pattern, "seqLength", "jumpMax", "currentSeq"
      FROM core.code_rules WHERE "entityType" = ${entityType} AND "deletedAt" IS NULL FOR UPDATE`;
    const rule = rows[0];
    if (!rule) throw new Error(`CodeRule missing: ${entityType}`);
    const nextSeq = rule.currentSeq + BigInt(randomInt(1, Math.max(2, rule.jumpMax + 1)));
    await tx.$executeRaw`UPDATE core.code_rules SET "currentSeq" = ${nextSeq}, "updatedAt" = now() WHERE id = ${rule.id}::uuid`;
    return rule.pattern
      .replace("{prefix}", rule.prefix)
      .replace(/\{seq:(\d+)\}/, (_, n: string) => nextSeq.toString().padStart(Math.max(Number(n), rule.seqLength), "0"));
  });
}

// ---------- 档案常量（全部取自 法国经销商.docx；IBAN 已刻意剔除） ----------

const JINGLIN_NAME = "SAS JINGLIN PARIS";
const JINGLIN_NOTES = [
  "【法国经销商·法定信息】VAT FR1948433925｜RCS 948 433 925 R.C.S. Nanterre｜注册地址 68 bd berthier 75017 Paris。",
  "【业务沿革】WELLHOPE（4 rue Camille Desmoulins 92300 Levallois-Perret）与本主体同址，为前身或关联公司；",
  "ZHOU LIHANG 个人主体为 JINGLIN 成立前的经营载体，现已停用。",
  "【下游销售沿革·仅作参考，未入平台交易】",
  "  FA000008（2026-03-03）CAVIAR Hybrid surgeon 30g ×36 罐，单价 €9.00，HT €324.00 / TTC €388.80，买方客户编码 001；",
  "  FA000010（2026-04-16）CAVIAR esturgeon 30g ×22 罐，单价 €2.00，HT €48.00 / TTC €57.60，买方客户编码 001。",
  "  收款账户信息按平台资金规范不入库（走 Stripe Connect），如需对账请查线下账务系统。",
].join("\n");

interface ArchiveOrg {
  key: string;
  legalName: string;
  partyType: "SUPPLIER" | "BUYER";
  countryIso2: string;
  /** 注册号（SIRET / RCS 等） */
  registrationNo?: string;
  taxId?: string;
  legalRep?: string;
  address?: string;
  riskNotes: string;
  supplier?: { businessScope: string };
  buyer?: { buyerType: "WHOLESALER" | "RETAILER" | "RESTAURANT" | "IMPORTER" | "DISTRIBUTOR"; city?: string };
  contact?: { name: string; phone?: string; email?: string; position?: string };
  shippingAddress?: { label: string; recipient: string; line1: string; city: string; postcode: string };
}

const ARCHIVE_ORGS: ArchiveOrg[] = [
  {
    key: "S-HLJ-0003",
    legalName: "WELLHOPE",
    partyType: "SUPPLIER",
    countryIso2: "FR",
    registrationNo: "SIRET 838 983 708 00028",
    taxId: "FR83838983708",
    address: "4 rue Camille Desmoulins 92300 Levallois-Perret",
    supplier: { businessScope: "鱼子酱销售、进出口贸易" },
    contact: { name: "（待补充）", phone: "+33 7 53 84 87 58", email: "caviar@wellhope.top" },
    riskNotes: [
      "【档案导入·非平台注册主体】源：法国经销商.docx，原编号 S-HLJ-0003，建档日期 2023-06-28。",
      "法国本地供应商，RCS Nanterre B 838 983 708；与 SAS JINGLIN PARIS 同址，可能为其前身或关联公司。",
      "【下游销售沿革·仅作参考，未入平台交易】",
      "  FR-001（2023-06-28）Caviar Huso dauricus × Acipenser schrenckii 1000g ×2，单价 €1,280.00，",
      "  HT €2,560.00 / TTC €3,072.00（VAT 20%），买方 CHEN STEINKERQUE，银行转账已结清。",
      "  该发票可作为 JINGLIN 的历史采购成本参考。",
      "【待补充】法定代表人｜统一社会信用代码｜成立日期｜注册资本。",
    ].join("\n"),
  },
  {
    key: "S-FR-0001",
    legalName: "ZHOU LIHANG",
    partyType: "SUPPLIER",
    countryIso2: "FR",
    legalRep: "ZHOU LIHANG",
    address: "27 Rue des Rosiers 75004 Paris",
    supplier: { businessScope: "鱼子酱销售" },
    riskNotes: [
      "【档案导入·非平台注册主体·历史主体】源：法国经销商.docx，原编号 S-FR-0001，建档日期 2025-12-19。",
      "自然人个人卖家，为 SAS JINGLIN PARIS 成立前的经营主体，现已停用。",
      "文档建议：并入 JINGLIN 或仅作历史主体保留，不再作为活跃供应商使用。",
      "【下游销售沿革·仅作参考，未入平台交易】",
      "  FA000007（2025-12-19，到期 2026-01-19）CAVIAR Hybrid surgeon 30g ×100 罐，单价 €15.00，",
      "  HT €1,500.00 / TTC €1,800.00（VAT 20%），买方客户编码 001，2026-01-19 银行转账结清。",
      "  收款账户信息按平台资金规范不入库。",
    ].join("\n"),
  },
  {
    key: "C-FR-0002",
    legalName: "CHEN STEINKERQUE",
    partyType: "BUYER",
    countryIso2: "FR",
    buyer: { buyerType: "RETAILER", city: "Paris" },
    address: "3 rue de Steinkerque 75018 Paris",
    shippingAddress: { label: "发票收货地址", recipient: "CHEN STEINKERQUE", line1: "3 rue de Steinkerque", city: "Paris", postcode: "75018" },
    riskNotes: [
      "【档案导入·非平台注册主体】源：法国经销商.docx，原编号 C-FR-0002，建档日期 2023-06-28。",
      "文档标注客户类型为 INDIVIDUAL（自然人）；平台无个人客户类型，暂以 RETAILER 建档，名称取自发票抬头。",
      "【关联业务】WELLHOPE 发票 FR-001（2023-06-28，TTC €3,072.00）的买方。",
      "【待补充】姓 / 名拆分｜联系电话｜电子邮箱｜VAT 号。",
    ].join("\n"),
  },
  {
    key: "C-FR-0003",
    legalName: "JINGLIN 客户编码 001（公司全称待补充）",
    partyType: "BUYER",
    countryIso2: "FR",
    buyer: { buyerType: "RETAILER" },
    riskNotes: [
      "【档案导入·非平台注册主体】源：法国经销商.docx，原编号 C-FR-0003，建档日期 2025-12-19。",
      "文档标注客户类型为 COMPANY，但发票上仅显示「客户编码 001」，公司全称未知，故名称为占位值。",
      "【关联业务】JINGLIN 侧多张销售发票的买方：FA000007（€1,800.00）、FA000008（€388.80）、FA000010（€57.60）。",
      "【待补充】公司全称｜联系人姓名｜联系电话｜电子邮箱｜完整收货地址｜VAT 号。",
    ].join("\n"),
  },
];

/** 文档 §8 待补充清单里与产品相关的部分（平台产品编码由 codegen 生成，不采用文档建议的 P-CAV-* 命名） */
const PRODUCT_TODO = [
  "Caviar Huso dauricus × Acipenser schrenckii 1000g",
  "CAVIAR Hybrid surgeon 30g",
  "CAVIAR esturgeon 30g",
];

// ---------- 导入 ----------

async function upsertArchiveOrg(spec: ArchiveOrg): Promise<{ code: string; created: boolean }> {
  const existing = await prisma.organization.findFirst({
    where: { legalNameBidx: bidx(spec.legalName), deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    await prisma.organization.update({
      where: { id: existing.id },
      data: { riskNotes: spec.riskNotes, version: { increment: 1 } },
    });
    return { code: existing.publicCode, created: false };
  }

  const code = await nextCode(spec.partyType);
  const org = await prisma.organization.create({
    data: {
      publicCode: code,
      partyType: spec.partyType,
      legalNameEnc: encrypt(spec.legalName),
      legalNameBidx: bidx(spec.legalName),
      registrationNoEnc: spec.registrationNo ? encrypt(spec.registrationNo) : null,
      taxIdEnc: spec.taxId ? encrypt(spec.taxId) : null,
      legalRepEnc: spec.legalRep ? encrypt(spec.legalRep) : null,
      addressEnc: spec.address ? encrypt(spec.address) : null,
      countryIso2: spec.countryIso2,
      status: "INACTIVE",
      riskNotes: spec.riskNotes,
    },
  });

  if (spec.supplier) {
    await prisma.supplierProfile.create({ data: { orgId: org.id, businessScope: spec.supplier.businessScope } });
  }
  if (spec.buyer) {
    await prisma.buyerProfile.create({ data: { orgId: org.id, buyerType: spec.buyer.buyerType, city: spec.buyer.city } });
  }
  if (spec.contact) {
    await prisma.contact.create({
      data: {
        orgId: org.id,
        nameEnc: encrypt(spec.contact.name),
        positionEnc: spec.contact.position ? encrypt(spec.contact.position) : null,
        phoneEnc: spec.contact.phone ? encrypt(spec.contact.phone) : null,
        emailEnc: spec.contact.email ? encrypt(spec.contact.email) : null,
        isPrimary: true,
      },
    });
  }
  if (spec.shippingAddress) {
    const a = spec.shippingAddress;
    await prisma.address.create({
      data: {
        orgId: org.id,
        label: a.label,
        recipientEnc: encrypt(a.recipient),
        phoneEnc: encrypt("（待补充）"),
        line1Enc: encrypt(a.line1),
        cityEnc: encrypt(a.city),
        postcode: a.postcode,
        countryIso2: spec.countryIso2,
        isDefault: true,
      },
    });
  }
  return { code: org.publicCode, created: true };
}

/** JINGLIN 已是平台买家主体：只补法定信息与沿革，绝不新建第二个 */
async function enrichJinglin(): Promise<string> {
  const org = await prisma.organization.findFirst({
    where: { legalNameBidx: bidx(JINGLIN_NAME), deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!org) {
    console.log("  ⚠ 未找到既有 SAS JINGLIN PARIS 主体（本库可能未跑过 seed-hzb-case），跳过补全");
    return "(未找到)";
  }
  const data: Prisma.OrganizationUpdateInput = { riskNotes: JINGLIN_NOTES, version: { increment: 1 } };
  if (!org.taxIdEnc) data.taxIdEnc = encrypt("FR1948433925");
  if (!org.registrationNoEnc) data.registrationNoEnc = encrypt("948 433 925 R.C.S. Nanterre");
  if (!org.addressEnc) data.addressEnc = encrypt("68 bd berthier 75017 Paris");
  await prisma.organization.update({ where: { id: org.id }, data });
  return org.publicCode;
}

async function main(): Promise<void> {
  console.log("法国业务伙伴档案导入（源：HZB/法国经销商.docx）\n");

  const jinglinCode = await enrichJinglin();
  console.log(`  ✔ SAS JINGLIN PARIS —— 补齐 VAT / RCS / 注册地址与业务沿革（${jinglinCode}）`);

  for (const spec of ARCHIVE_ORGS) {
    const { code, created } = await upsertArchiveOrg(spec);
    console.log(`  ${created ? "✔ 新建" : "↻ 已存在，更新备注"} ${spec.legalName}（原编号 ${spec.key} → ${code}）`);
  }

  console.log("\n未导入项（按业务边界刻意留白）：");
  console.log("  · 四笔历史零售订单与发票 —— 属经销商下游业务，平台无对应交易层，仅写入主体备注");
  console.log("  · 两个 IBAN 收款账号 —— 按平台资金与 PII 规范不入库");
  console.log(`  · 三个待建产品编码 —— ${PRODUCT_TODO.join("｜")}`);
  console.log("    （平台产品编码由 codegen 生成，文档建议的 P-CAV-* 命名不适用；需上架时走供应商产品流程）");
  console.log("\n✅ 完成。档案状态均为 INACTIVE（已建档、未启用），不进入入驻审核队列。");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
