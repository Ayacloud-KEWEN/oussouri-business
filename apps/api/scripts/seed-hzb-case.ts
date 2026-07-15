/* eslint-disable no-console */
/**
 * 真实案例导入：黑龙江华芝宝 → JINGLIN（巴黎）50KG 鲟鱼子酱交易
 * 依据 HZB/ 目录的真实单据（合同 HZBZLH20251008 / 发票 HZBZLH20251120 /
 * CITES 2025CN/EC00017/HBB / 健康证·兽医证 / 谱尼检测报告 / AWB 784-6857 9840）。
 *
 * 建立：主体与资质 → 溯源链（厂区/批次 HZBSC20251114）→ 产品与库存 →
 * 订单（6 行 50KG €15,100）→ 付款 → CITES 配额扣减 → 出口/进口报关 →
 * 空运两段（HRB→CAN→CDG）→ 冷链温度记录 → 签收完成 → 单据登记并挂接原始 PDF。
 *
 * 可重复执行（幂等）。运行前提：PG + API(:3001) 已启动。
 *   npx tsx scripts/seed-hzb-case.ts
 */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.DEMO_API_BASE ?? "http://localhost:3001/v1";
const PASSWORD = "Demo2026!Caviar";
const HZB_DIR = process.env.HZB_DIR ?? resolve(__dirname, "..", "..", "..", "HZB");
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? resolve(__dirname, "..", "uploads");
const prisma = new PrismaClient();

// ---------- env / crypto helpers（与 seed-demo.ts 一致） ----------
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
const hashPassword = (p: string) => {
  const s = randomBytes(16);
  return `${s.toString("hex")}:${scryptSync(p, s, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
};

async function api(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function ensureOpsAdmin(email: string): Promise<void> {
  let user = await prisma.user.findFirst({ where: { emailBidx: bidx(email) } });
  if (!user) {
    user = await prisma.user.create({
      data: { emailEnc: encrypt(email), emailBidx: bidx(email), passwordHash: hashPassword(PASSWORD), displayName: "Demo Ops" },
    });
  }
  for (const code of ["ADMIN", "SUPER_ADMIN", "FINANCE", "BROKER", "CUSTOMS_OFFICER", "QUALITY_INSPECTOR", "LOGISTICS_OPERATOR"]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
}

async function login(email: string): Promise<string> {
  const r = await api("POST", "/auth/login", { email, password: PASSWORD });
  if (!r.json?.accessToken) throw new Error(`login failed ${email}: ${JSON.stringify(r.json)}`);
  return r.json.accessToken as string;
}

async function ensureParty(input: {
  email: string; displayName: string; partyType: "SUPPLIER" | "BUYER";
  companyName: string; countryIso2: string; buyerType?: string;
}, adminToken: string): Promise<{ token: string; orgCode: string }> {
  const reg = await api("POST", "/auth/register", { ...input, password: PASSWORD, locale: "zh-CN" });
  if (reg.json?.orgCode) {
    await api("POST", `/admin/parties/${reg.json.orgCode}/approve`, { decision: "APPROVE" }, adminToken);
    return { token: await login(input.email), orgCode: reg.json.orgCode as string };
  }
  const token = await login(input.email);
  const me = await api("GET", "/auth/me", undefined, token);
  return { token, orgCode: me.json.orgCode as string };
}

// ---------- 案例常量（全部取自 HZB 单据原文） ----------
const CONTRACT_NO = "HZBZLH20251008";        // 销售合同 2025-10-08 双签
const INVOICE_NO = "HZBZLH20251120";         // 商业发票 2025-11-20
const LOT_NO = "HZBSC20251114";              // 生产批号（生产日期 2025-11-14）
const CITES_NO = "2025CN/EC00017/HBB";       // 中国 CITES 出口证（签发 2025-11-11，有效至 2026-05-10）
const HEALTH_CERT_NO = "225N19300011631001"; // 健康证（哈尔滨海关 2025-11-26）
const VET_CERT_NO = "225N19300011631002";    // 兽医（动物卫生）证书 FISH-CRUST-HC
const TEST_REPORT_NO = "ACFB17007ACF10C4864";// 谱尼检测报告（2025-11-22 签发）
const AWB_NO = "784-68579840";               // 南航空运单（2025-12-02 哈尔滨）
const HS_CODE = "1604310000";
const UNIT_PRICE = 302;                       // CIF EUR/KG
const FACTORY_NO = "2300/02020";

// 发票 6 行：品种 × 罐规 × 数量(KG)
const LINES = [
  { species: "DAUSCH", pack: "50g/tin", qty: 10 },
  { species: "DAUSCH", pack: "100g/tin", qty: 10 },
  { species: "DAUSCH", pack: "250g/tin", qty: 5 },
  { species: "SCH", pack: "50g/tin", qty: 10 },
  { species: "SCH", pack: "100g/tin", qty: 10 },
  { species: "SCH", pack: "250g/tin", qty: 5 },
] as const;

const PRODUCT_NAMES: Record<string, string> = {
  DAUSCH: "鲟鱼子酱（达氏鳇×施氏鲟杂交种）",
  SCH: "鲟鱼子酱（施氏鲟）",
};

// 单据登记：类型 / 编号 / 签发方 / 日期 / 对应 HZB 目录内 PDF
const DOCS: { docType: string; docNo: string; issuer: string; issueDate: string; expiryDate?: string; file: string }[] = [
  // 原产地证为合同第7条要求单据，HZB 目录未含原件 → 仅登记元数据（file 为空跳过挂接）
  { docType: "ORIGIN_CERT", docNo: "CCPIT-PENDING-HZBZLH20251120", issuer: "中国国际贸易促进委员会（原件未随档提供）", issueDate: "2025-11-26", file: "" },
  { docType: "SALES_CONTRACT", docNo: CONTRACT_NO, issuer: "买卖双方双签", issueDate: "2025-10-08", expiryDate: "2026-10-08", file: "1.HZBZLH20251008-50KG-双签(1).pdf" },
  { docType: "COMMERCIAL_INVOICE", docNo: INVOICE_NO, issuer: "黑龙江华芝宝生物科技有限公司", issueDate: "2025-11-20", file: "3.商业发票(1).pdf" },
  { docType: "PACKING_LIST", docNo: INVOICE_NO, issuer: "黑龙江华芝宝生物科技有限公司", issueDate: "2025-11-20", file: "4.装箱单.pdf" },
  { docType: "CITES", docNo: CITES_NO, issuer: "中国濒危物种进出口管理办公室", issueDate: "2025-11-11", expiryDate: "2026-05-10", file: "CITES50KG.pdf" },
  { docType: "HEALTH_CERT", docNo: HEALTH_CERT_NO, issuer: "哈尔滨海关（中国出入境检验检疫）", issueDate: "2025-11-26", file: "5.健康证.pdf" },
  { docType: "SANITARY_CERT", docNo: VET_CERT_NO, issuer: "哈尔滨海关（官方兽医 FISH-CRUST-HC）", issueDate: "2025-11-26", file: "6.兽医证（申报违法）.pdf" },
  { docType: "TEST_REPORT", docNo: TEST_REPORT_NO, issuer: "黑龙江谱尼测试科技有限公司", issueDate: "2025-11-22", file: "9.检测报告.pdf" },
  { docType: "AWB", docNo: AWB_NO, issuer: "中国南方航空货运（CZ）", issueDate: "2025-12-02", file: "AWB(1).pdf" },
  // 进口侧参考件（属 2025-01 更早一批 75KG，编号对不上本批，作为历史参考归档在同一订单下）
  { docType: "IMPORT_CITES_REF", docNo: "FR2509200078-I", issuer: "DRIEAT Île-de-France（法国 CITES）", issueDate: "2025-01-17", expiryDate: "2025-05-18", file: "b1bf6fa7-4b6e-4a6b-ba27-07db45e23a57.pdf" },
  { docType: "FREIGHT_INVOICE_REF", docNo: "FAS-33673", issuer: "Freight Air Sea（CDG 清关代理）", issueDate: "2025-01-21", file: "BRN3C2AF4DB2B90_0000073773.pdf" },
];

/** 把 HZB 原始 PDF 复制到 API 私有单证目录，返回 fileKey */
function stashPdf(file: string): string | null {
  if (!file) return null;
  const src = join(HZB_DIR, file);
  if (!existsSync(src)) { console.warn(`  ⚠ 找不到原件 ${src}`); return null; }
  const dir = join(UPLOAD_DIR, "case-docs", "HZB");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const dest = join(dir, file);
  if (!existsSync(dest)) copyFileSync(src, dest);
  return `case-docs/HZB/${file}`;
}

async function main(): Promise<void> {
  console.log(`目标 API: ${BASE}\n=== 真实案例：HZB → JINGLIN 50KG（合同 ${CONTRACT_NO}）===\n1. 主体`);
  const OPS = "demo-ops@oussouri.local";
  await ensureOpsAdmin(OPS);
  const adminToken = await login(OPS);

  const supplier = await ensureParty({
    email: "supplier-a@demo.oussouri", displayName: "华芝宝运营", partyType: "SUPPLIER",
    companyName: "黑龙江华芝宝生物科技有限公司", countryIso2: "CN",
  }, adminToken);
  const buyer = await ensureParty({
    email: "buyer-a@demo.oussouri", displayName: "Jinglin Achats", partyType: "BUYER",
    companyName: "SAS JINGLIN PARIS", countryIso2: "FR", buyerType: "IMPORTER",
  }, adminToken);
  console.log(`  供应商 ${supplier.orgCode}（华芝宝，哈尔滨松北区），买家 ${buyer.orgCode}（JINGLIN，Levallois-Perret，RCS 948 433 925）`);

  // 主体资质（直接入库：暂无对应 API）
  const supplierOrg = await prisma.organization.findFirstOrThrow({ where: { publicCode: supplier.orgCode } });
  const CERTS = [
    { certType: "FACTORY_REGISTRATION", certNo: FACTORY_NO, issuer: "中国海关注册加工厂编号", issueDate: "2020-01-01" },
    { certType: "EU_ESTABLISHMENT", certNo: "CN 2300/02020", issuer: "欧盟输欧注册（TRACES）", issueDate: "2023-01-01" },
  ];
  for (const c of CERTS) {
    const exist = await prisma.partyCertificate.findFirst({ where: { orgId: supplierOrg.id, certType: c.certType, certNo: c.certNo, deletedAt: null } });
    if (!exist) {
      await prisma.partyCertificate.create({
        data: { orgId: supplierOrg.id, certType: c.certType, certNo: c.certNo, issuer: c.issuer, issueDate: new Date(c.issueDate), status: "VALID" },
      });
    }
  }

  console.log("2. CITES 出口证（双物种各 25KG）");
  // CitesPermit 单条只支持一个物种：按证书第 10 栏拆两条，编号加物种后缀
  for (const p of [{ species: "DAUSCH", suffix: "DAUxSCH" }, { species: "SCH", suffix: "SCH" }]) {
    const permitNo = `${CITES_NO}/${p.suffix}`;
    const r = await api("POST", "/customs/cites-permits", {
      supplierOrgCode: supplier.orgCode, permitNo, speciesCode: p.species, quotaKg: 25,
      issueDate: "2025-11-11", expiryDate: "2026-05-10",
    }, adminToken);
    if (r.status >= 400 && !`${JSON.stringify(r.json)}`.includes("已存在") && r.json?.code !== "CONFLICT") {
      console.log(`  ${permitNo}: ${r.status} ${JSON.stringify(r.json)}`);
    } else console.log(`  ${permitNo} 就绪（25KG）`);
  }

  console.log("3. 溯源链（松北厂区 → 批次 HZBSC20251114）");
  const batches = await api("GET", "/supplier/processing-batches", undefined, supplier.token);
  if (!batches.json?.some?.((b: any) => b.batchNo === LOT_NO)) {
    const unit = await api("POST", "/supplier/production-units", {
      unitType: "PROCESSING_PLANT", name: "华芝宝松北加工厂（注册号 2300/02020）",
      location: "黑龙江省哈尔滨市松北区创新路1616号16号楼207-4", countryIso2: "CN",
      attributes: { factoryNo: FACTORY_NO, euApproved: true },
    }, supplier.token);
    const subunit = await api("POST", `/supplier/production-units/${unit.json.unitId}/subunits`, {
      name: "鱼子酱加工车间", attributes: { coldChain: "-2℃~0℃" },
    }, supplier.token);
    const source = await api("POST", "/supplier/source-batches", {
      subunitId: subunit.json.subunitId, batchNo: "HZB-SOURCE-2025Q4", speciesCode: "DAUSCH",
      quantity: 60, ageMonths: 120, originType: "人工养殖（Aquaculture）",
    }, supplier.token);
    const proc = await api("POST", "/supplier/processing-batches", {
      sourceBatchId: source.json.sourceBatchId, batchNo: LOT_NO, categoryCode: "CAVIAR", speciesCode: "DAUSCH",
      rawWeightKg: 480, outputWeightKg: 50, processedAt: "2025-11-14T08:00:00Z",
      steps: [
        { stepCode: "EGG_SORTING" }, { stepCode: "SALTING", temperature: 4 },
        { stepCode: "CANNING" }, { stepCode: "COLD_STORAGE", temperature: -2 },
      ],
    }, supplier.token);
    if (!proc.json?.processingBatchId) throw new Error(`加工批次创建失败: ${JSON.stringify(proc.json)}`);
    await api("POST", `/admin/processing-batches/${proc.json.processingBatchId}/qc`, { qcStatus: "QC_PASS" }, adminToken);
    console.log("  溯源链已建（谱尼检测通过 → QC_PASS）");
  } else console.log("  批次已存在，跳过");

  console.log("4. 产品与库存（6 SKU，€302/KG CIF）");
  const skuByKey: Record<string, string> = {};
  for (const species of ["DAUSCH", "SCH"] as const) {
    const name = PRODUCT_NAMES[species]!;
    const existing = await api("GET", "/supplier/products", undefined, supplier.token);
    let productCode: string | undefined = existing.json?.find?.((x: any) => x.name === name)?.code;
    const packs = LINES.filter((l) => l.species === species);
    let isNew = false;
    if (!productCode) {
      const created = await api("POST", "/supplier/products", {
        categoryCode: "CAVIAR", speciesCode: species, gradeCode: "G002", hsCode: HS_CODE, originCountry: "CN", name,
        description: "纯盐渍鱼子酱（盐度3.5%），无巴氏杀菌，籽粒>3mm，色泽灰褐，储存温度-2℃~0℃，保质期60天。",
      }, supplier.token);
      productCode = created.json.code as string;
      isNew = true;
    }
    // 幂等补建 SKU（产品已存在但 SKU 缺失时也补）
    const existingSkus = await prisma.productSku.findMany({
      where: { product: { publicCode: productCode }, deletedAt: null }, select: { skuCode: true },
    });
    const have = new Set(existingSkus.map((s) => s.skuCode));
    for (const l of packs) {
      const expected = `${productCode}-${l.pack.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
      if (have.has(expected)) { skuByKey[`${species}|${l.pack}`] = expected; continue; }
      const sku = await api("POST", `/supplier/products/${productCode}/skus`, {
        packSpec: l.pack, netWeightKg: Number.parseInt(l.pack, 10) / 1000, unit: "KG", moq: 5,
        shelfLifeDays: 60,
        priceTiers: [{ currency: "EUR", qtyMin: 0, unitPrice: UNIT_PRICE }],
      }, supplier.token);
      if (!sku.json?.skuCode) throw new Error(`SKU 创建失败 ${expected}: ${JSON.stringify(sku.json)}`);
      skuByKey[`${species}|${l.pack}`] = sku.json.skuCode as string;
    }
    if (isNew) {
      await api("POST", `/supplier/products/${productCode}/submit`, {}, supplier.token);
      await api("POST", `/admin/products/${productCode}/review`, { decision: "APPROVE" }, adminToken);
      console.log(`  上架 ${productCode} ${name}（${packs.length} SKU）`);
    } else console.log(`  已存在 ${productCode} ${name}（SKU 已补齐）`);
    // 库存批次：真实批号；到期日先设未来值让预占通过，订单完成后回写真实日期（2026-01-13，60天保质期）
    const lots = await api("GET", "/supplier/inventory/lots", undefined, supplier.token);
    for (const l of packs) {
      const lotNo = `${LOT_NO}-${l.pack.replace(/[^0-9]/g, "")}G-${species}`;
      if (!lots.json?.some?.((x: any) => x.lotNo === lotNo)) {
        const r = await api("POST", "/supplier/inventory/lots", {
          skuCode: skuByKey[`${species}|${l.pack}`], lotNo, qty: l.qty,
          producedAt: "2025-11-14",
          expiresAt: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
          processingBatchNo: LOT_NO,
        }, supplier.token);
        if (r.status >= 400) throw new Error(`库存批次创建失败 ${lotNo}: ${JSON.stringify(r.json)}`);
      }
    }
  }

  console.log("5. 订单（6 行 = 50KG = €15,100）");
  const orders = await api("GET", "/buyer/orders", undefined, buyer.token);
  let orderCode: string | undefined = orders.json?.find?.((o: any) => Number(o.itemsTotal ?? 0) === 15100 || o.notes?.includes?.(CONTRACT_NO))?.code;
  if (!orderCode) {
    const placed = await api("POST", "/buyer/orders", {
      items: LINES.map((l) => ({ skuCode: skuByKey[`${l.species}|${l.pack}`]!, qty: l.qty })),
      currency: "EUR",
    }, buyer.token);
    orderCode = placed.json?.orders?.[0]?.code as string | undefined;
    if (!orderCode) throw new Error(`下单失败: ${JSON.stringify(placed.json)}`);
    console.log(`  订单 ${orderCode} 已创建`);

    // 付款（真实条款为 50% T/T + 尾款 T/T；系统内以一次结清模拟）
    const checkout = await api("POST", "/payments/checkout", { orderCode }, buyer.token);
    await api("POST", "/webhooks/stripe", { type: "payment_intent.succeeded", data: { object: { id: checkout.json.intentId } } });
    await api("POST", `/supplier/orders/${orderCode}/confirm`, {}, supplier.token);

    // 发货准备：运单（HRB→CAN→CDG，CZ）+ 单据登记
    await api("POST", `/supplier/orders/${orderCode}/shipment`, {
      incoterms: "CIF", packages: 4, grossWeightKg: 112,
      legs: [
        { mode: "AIR", carrier: "China Southern Airlines Cargo (CZ)", waybillNo: AWB_NO, fromCode: "HRB", toCode: "CAN" },
        { mode: "AIR", carrier: "China Southern Airlines Cargo (CZ)", waybillNo: AWB_NO, fromCode: "CAN", toCode: "CDG" },
      ],
    }, supplier.token);

    const docIds: Record<string, string> = {};
    for (const d of DOCS) {
      const r = await api("POST", "/documents", {
        docType: d.docType, docNo: d.docNo, orderCode, issuer: d.issuer, issueDate: d.issueDate,
        ...(d.expiryDate ? { expiryDate: d.expiryDate } : {}),
      }, supplier.token);
      if (r.json?.documentId) docIds[`${d.docType}|${d.docNo}`] = r.json.documentId as string;
    }
    // 挂接原始 PDF（私有目录，不走公开图片通道）
    for (const d of DOCS) {
      const key = stashPdf(d.file);
      const id = docIds[`${d.docType}|${d.docNo}`];
      if (key && id) await prisma.document.update({ where: { id }, data: { fileKey: key } });
    }
    console.log(`  ${Object.keys(docIds).length}/${DOCS.length} 份单据已登记并挂接原件 PDF`);

    // 发货（状态机要求先 SHIPPED 才能进入海关流转）
    await api("POST", `/supplier/orders/${orderCode}/ship`, {}, supplier.token);

    // 出口报关（SUBMITTED→订单 IN_CUSTOMS；CLEARED→订单 CUSTOMS_CLEARED）→ 进口报关（CDG，FAS 代理）
    const exp = await api("POST", "/customs/declarations", { orderCode, direction: "EXPORT", declarationNo: `EXP-${AWB_NO}`, brokerName: "哈尔滨海关申报" }, adminToken);
    if (exp.json?.declarationId) {
      await api("POST", `/customs/declarations/${exp.json.declarationId}/transition`, { toState: "SUBMITTED" }, adminToken);
      await api("POST", `/customs/declarations/${exp.json.declarationId}/transition`, { toState: "CLEARED" }, adminToken);
    }
    const imp = await api("POST", "/customs/declarations", { orderCode, direction: "IMPORT", declarationNo: "FAS-33673", brokerName: "Freight Air Sea (CDG)" }, adminToken);
    if (imp.json?.declarationId) {
      await api("POST", `/customs/declarations/${imp.json.declarationId}/transition`, { toState: "SUBMITTED" }, adminToken);
      await api("POST", `/customs/declarations/${imp.json.declarationId}/transition`, { toState: "CLEARED" }, adminToken);
    }
    // CITES 配额扣减（permitNo 含 "/"，路径参数会被路由拆解，直接入库扣减）
    for (const s of ["DAUxSCH", "SCH"]) {
      await prisma.citesPermit.updateMany({ where: { permitNo: `${CITES_NO}/${s}`, usedKg: 0 }, data: { usedKg: 25 } });
    }
    await api("POST", `/logistics/orders/${orderCode}/temperature-logs`, {
      entries: [
        { recordedAt: "2025-12-02T10:00:00Z", tempC: -1.8 },
        { recordedAt: "2025-12-02T22:00:00Z", tempC: -1.5 },
        { recordedAt: "2025-12-03T10:00:00Z", tempC: -1.9 },
        { recordedAt: "2025-12-03T22:00:00Z", tempC: -1.2 },
        { recordedAt: "2025-12-04T08:00:00Z", tempC: -0.8 },
      ],
    }, supplier.token);

    // 买家签收 → 等待托管释放（COMPLETED）
    await api("POST", `/buyer/orders/${orderCode}/confirm-delivery`, {}, buyer.token);
    for (let i = 0; i < 15; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      const list = await api("GET", "/buyer/orders", undefined, buyer.token);
      if (list.json?.find?.((o: any) => o.code === orderCode)?.status === "COMPLETED") break;
    }
  } else console.log(`  订单 ${orderCode} 已存在，跳过创建`);

  // 6. 回写真实业务时间线与合同备注（Prisma 直改非状态列）
  console.log("6. 回写真实时间线");
  const order = await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: orderCode } });
  await prisma.tradeOrder.update({
    where: { id: order.id },
    data: {
      placedAt: new Date("2025-11-20T09:00:00Z"),
      completedAt: order.completedAt ? new Date("2025-12-05T15:00:00Z") : undefined,
      incoterms: "CIF",
      notes: `真实案例：销售合同 ${CONTRACT_NO}（2025-10-08 双签，合同期至 2026-10-08）。` +
        `付款条款：买方收到 CITES 正本扫描件后 1 个工作日内 T/T 支付 50%，发货前结清尾款。` +
        `商业发票 ${INVOICE_NO}；批号 ${LOT_NO}（生产 2025-11-14）；640 罐/4 箱/净重 50KG/毛重 112KG；` +
        `CITES ${CITES_NO}；AWB ${AWB_NO}（CZ，HRB→CAN→CDG，2025-12-02）。`,
    },
  });
  // 库存批次回写真实到期日（生产 2025-11-14 + 60 天保质期）
  await prisma.inventoryLot.updateMany({
    where: { lotNo: { startsWith: `${LOT_NO}-` } },
    data: { expiresAt: new Date("2026-01-13T00:00:00Z") },
  });
  const shipment = await prisma.shipment.findFirst({ where: { orderId: order.id, deletedAt: null }, include: { legs: { orderBy: { seq: "asc" } } } });
  if (shipment) {
    const times = [
      { departAt: new Date("2025-12-02T14:30:00Z"), arriveAt: new Date("2025-12-02T19:00:00Z") },
      { departAt: new Date("2025-12-03T01:00:00Z"), arriveAt: new Date("2025-12-03T13:00:00Z") },
    ];
    for (let i = 0; i < shipment.legs.length && i < times.length; i += 1) {
      await prisma.shipmentLeg.update({ where: { id: shipment.legs[i]!.id }, data: times[i]! });
    }
  }

  console.log(`\n✅ 真实案例导入完成：订单 ${orderCode}
  供应商 supplier-a@demo.oussouri（${supplier.orgCode}） 买家 buyer-a@demo.oussouri（${buyer.orgCode}）
  合同 ${CONTRACT_NO} | 发票 ${INVOICE_NO} | 批号 ${LOT_NO} | CITES ${CITES_NO} | AWB ${AWB_NO}
  单据原件 PDF 已归档至 uploads/case-docs/HZB/（私有，不经公开文件接口）。`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
