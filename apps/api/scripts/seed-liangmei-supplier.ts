/* eslint-disable no-console */
/**
 * 真实供应商导入：湖南良美东江湖食品有限公司（源：HZB/养殖基地入库信息3.docx，2026-07-20）
 * 东江湖国家一级饮用水源养殖，27 年鱼子酱专业厂，CITES 备案企业。
 *
 * 建立：主体与档案 → 联系人 → 3 项资质（CITES 待办状态）→ 东江湖养殖基地 →
 * 2 产品（50g 马口铁罐 / 500g 礼盒装，€285/kg，尊享级 9 年鱼龄）
 *   —— 含结构化品质数据：8 条工艺特色 + 21 项营养成分（谱尼报告）+ 品鉴与搭配建议 →
 * 库存 → 待付款订单 ORD-20260712-001（合同 LMDJH/SAS2026/07，10KG €2,850）。
 *
 * 身份防火墙：品牌名与精确厂址只入内部档案（riskNotes/加密列），
 * 公开产品页仅展示不含身份标识的工艺、营养、品鉴内容。
 *
 * 可重复执行（幂等）。前提：PG + API 已启动。
 *   npx tsx scripts/seed-liangmei-supplier.ts
 */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.DEMO_API_BASE ?? "http://localhost:3001/v1";
const PASSWORD = "Demo2026!Caviar";
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

// ---------- 案例常量（取自入库文档） ----------
const CONTRACT_NO = "LMDJH/SAS2026/07";

/** 工艺特色（去品牌名，保留可核查的工艺事实） */
const FEATURES = [
  "水源：国家 5A 级景区东江湖，国家一级饮用水标准，106 项水质指标达国家地表一类水",
  "低温慢养：湖区水温常年 8–12℃，生长期长、营养积累充分",
  "净化 30 天：原料鱼宰前 30 天停食并转入更低温冷水区，提升风味与口感",
  "无抗养殖：全程不使用抗生素及含抗生素、激素的饲料，具备无抗认证",
  "加工环境：10 万级无菌车间、13℃ 恒温、5℃ 低温冷水作业",
  "古法腌制结合现代工艺：16 道精细工序，标准化生产流程",
  "HACCP 体系认证，源头工厂批次品质一致",
  "全程冷链直发，产地到餐桌保持新鲜",
];

/** 谱尼检测报告 B1DA30066B1F1077960（2023-11）营养成分 */
const NUTRITION = [
  { label: "蛋白质", value: "26.5", unit: "g/100g" },
  { label: "氨基酸总量（16 种）", value: "26.0", unit: "g/100g" },
  { label: "EPA + DHA", value: "0.852", unit: "g/100g" },
  { label: "牛磺酸", value: "28.8", unit: "mg/100g" },
  { label: "维生素 A", value: "46.4", unit: "μg/100g" },
  { label: "维生素 D", value: "14.9", unit: "μg/100g" },
  { label: "维生素 E", value: "12.6", unit: "mg/100g" },
  { label: "维生素 B1", value: "0.686", unit: "mg/100g" },
  { label: "维生素 B2", value: "0.903", unit: "mg/100g" },
  { label: "维生素 B6", value: "1.17", unit: "mg/100g" },
  { label: "叶酸", value: "97.0", unit: "μg/100g" },
  { label: "生物素", value: "5.01", unit: "μg/100g" },
  { label: "烟酸", value: "0.69", unit: "mg/100g" },
  { label: "泛酸", value: "4.19", unit: "mg/100g" },
  { label: "铁", value: "22.8", unit: "mg/kg" },
  { label: "锌", value: "21.3", unit: "mg/kg" },
  { label: "镁", value: "285", unit: "mg/kg" },
  { label: "钙", value: "75.4", unit: "mg/kg" },
  { label: "硒", value: "0.703", unit: "mg/kg" },
  { label: "碘", value: "0.188", unit: "mg/kg" },
];

const TASTING = [
  "鱼龄 9 年，尊享级；粒径 ≥2.8mm",
  "色泽：黑色至灰褐色，颗粒晶莹分明",
  "口感：入口绵滑纯正，回味清淡，带淡淡奶香",
  "盐度 3.5%（每 100g 添加 3.5g 盐），存储 -2℃ 至 +2℃",
];

const PAIRING = [
  "直接品鉴：贝壳勺取用置于舌尖，以舌与上颚轻压，感受爆浆口感",
  "佐面包：涂抹于全麦面包或法棍，提升层次",
  "配鸡蛋：置于水煮蛋黄之上或拌食",
  "配苏打饼干：酥脆与细腻结合",
];

const NUTRITION_NOTE = "检测机构：谱尼测试（PONY），报告编号 B1DA30066B1F1077960，检测日期 2023-11-02 至 2023-11-20。";

const PRODUCTS = [
  {
    key: "TIN50", pack: "50g/tin", name: "杂交鲟鱼子酱·尊享级 9 年（史氏鲟×达氏鳇）",
    desc: "东江湖冷水养殖 9 年鱼龄杂交鲟（史氏鲟×达氏鳇）鱼子酱，粒径 ≥2.8mm，盐度 3.5% 纯盐渍，50g 马口铁罐装。",
    orderQty: 5, lotQty: 20,
  },
  {
    key: "GIFT500", pack: "500g/gift-tin", name: "杂交鲟鱼子酱·尊享级 9 年（500g 礼盒装）",
    desc: "同批次 9 年鱼龄杂交鲟鱼子酱，500g 大罐礼盒装，适合餐饮与礼品渠道，粒径 ≥2.8mm，存储 -2℃ 至 +2℃。",
    orderQty: 5, lotQty: 20,
  },
] as const;

const PRICE_EUR = 285;

async function main(): Promise<void> {
  console.log(`目标 API: ${BASE}\n=== 真实供应商：湖南良美东江湖食品（合同 ${CONTRACT_NO}）===\n1. 主体`);
  const OPS = "demo-ops@oussouri.local";
  await ensureOpsAdmin(OPS);
  const adminToken = await login(OPS);

  const supplier = await ensureParty({
    email: "supplier-d@demo.oussouri", displayName: "良美东江湖", partyType: "SUPPLIER",
    companyName: "湖南良美东江湖食品有限公司", countryIso2: "CN",
  }, adminToken);
  const buyer = await ensureParty({
    email: "buyer-a@demo.oussouri", displayName: "Jinglin Achats", partyType: "BUYER",
    companyName: "SAS JINGLIN PARIS", countryIso2: "FR", buyerType: "IMPORTER",
  }, adminToken);
  console.log(`  供应商 ${supplier.orgCode}（良美东江湖），买家 ${buyer.orgCode}`);

  const org = await prisma.organization.findFirstOrThrow({ where: { publicCode: supplier.orgCode } });
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      addressEnc: encrypt("中国湖南省郴州市资兴市东江街道罗围食品工业园罗围路2号"),
      // 品牌名属身份标识：仅内部风控备注可见，不进公开产品页
      riskNotes: "品牌「普梵希 / PUVENCHY」；27 年专注鱼子酱产业，CITES 备案企业；东江湖国家一级饮用水源养殖。",
    },
  });
  await prisma.supplierProfile.upsert({
    where: { orgId: org.id },
    create: { orgId: org.id, businessScope: "鲟鱼养殖、鱼子酱加工、水产品生产销售、进出口贸易", tier: "T1", exportReady: true },
    update: { exportReady: true },
  });

  if ((await prisma.contact.count({ where: { orgId: org.id, deletedAt: null } })) === 0) {
    await prisma.contact.create({
      data: {
        orgId: org.id, nameEnc: encrypt("销售负责人（姓名待补充）"), positionEnc: encrypt("销售负责人"),
        phoneEnc: encrypt("+86 18670260999"), isPrimary: true,
      },
    });
  }

  console.log("2. 资质证书");
  const CERTS = [
    { certType: "EXPORT_LICENSE", certNo: "PENDING-EXPORT", issuer: "海关总署（证号待补充）", status: "VALID" as const },
    { certType: "HACCP", certNo: "PENDING-HACCP", issuer: "HACCP 体系认证（证号待补充）", status: "VALID" as const },
    // 合同发货前 60 天办理，当前尚未取得
    { certType: "CITES", certNo: "PENDING-CITES-2026Q3", issuer: "中华人民共和国濒危物种进出口管理办公室（预计 2026-09 发货前办妥）", status: "PENDING" as const },
  ];
  for (const c of CERTS) {
    const exist = await prisma.partyCertificate.findFirst({ where: { orgId: org.id, certType: c.certType, deletedAt: null } });
    if (!exist) await prisma.partyCertificate.create({ data: { orgId: org.id, certType: c.certType, certNo: c.certNo, issuer: c.issuer, status: c.status } });
  }
  console.log("  出口备案 / HACCP / CITES（待办）已登记");

  console.log("3. 养殖基地（东江湖）");
  const units = await api("GET", "/supplier/production-units", undefined, supplier.token);
  if ((units.json?.length ?? 0) === 0) {
    const unit = await api("POST", "/supplier/production-units", {
      unitType: "FARM", name: "东江湖冷水鲟鱼养殖基地", location: "湖南省郴州市资兴市东江湖",
      countryIso2: "CN",
      attributes: {
        waterSource: "东江湖国家一级饮用水源（106 项指标达地表一类水）",
        waterTempMin: 8, waterTempMax: 12, farmType: "CAGE", antibioticFree: true, purgeDays: 30,
      },
    }, supplier.token);
    if (unit.json?.unitId) {
      await api("POST", `/supplier/production-units/${unit.json.unitId}/subunits`, { name: "9 年龄成鱼区", attributes: { ageYears: 9 } }, supplier.token);
      await api("POST", `/supplier/production-units/${unit.json.unitId}/subunits`, { name: "净化冷水区", attributes: { purgeDays: 30 } }, supplier.token);
    }
    console.log("  基地与 2 个养殖区已建");
  } else console.log("  基地已存在，跳过");

  console.log("4. 产品（含营养成分与品鉴数据）与库存");
  const skuByKey: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const existing = await api("GET", "/supplier/products", undefined, supplier.token);
    let productCode: string | undefined = existing.json?.find?.((x: any) => x.name === p.name)?.code;
    let isNew = false;
    if (!productCode) {
      const created = await api("POST", "/supplier/products", {
        categoryCode: "CAVIAR", speciesCode: "SCHDAU", gradeCode: "G001", hsCode: "1604310000", originCountry: "CN",
        name: p.name, description: p.desc,
        attributes: {
          features: FEATURES, nutrition: NUTRITION, nutritionNote: NUTRITION_NOTE,
          tasting: TASTING, pairing: PAIRING,
          processNote: "以上工艺与检测数据由供应商提供并经平台留档核验；营养成分为该批次抽检值，实际以随货检测报告为准。",
        },
      }, supplier.token);
      productCode = created.json?.code as string | undefined;
      if (!productCode) throw new Error(`产品创建失败: ${JSON.stringify(created.json)}`);
      isNew = true;
    }
    const expected = `${productCode}-${p.pack.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
    const haveSkus = new Set((await prisma.productSku.findMany({
      where: { product: { publicCode: productCode }, deletedAt: null }, select: { skuCode: true },
    })).map((s) => s.skuCode));
    if (haveSkus.has(expected)) skuByKey[p.key] = expected;
    else {
      const sku = await api("POST", `/supplier/products/${productCode}/skus`, {
        packSpec: p.pack, netWeightKg: Number.parseInt(p.pack, 10) / 1000, unit: "KG", moq: 1, shelfLifeDays: 60,
        priceTiers: [{ currency: "EUR", qtyMin: 0, unitPrice: PRICE_EUR }],
      }, supplier.token);
      if (!sku.json?.skuCode) throw new Error(`SKU 创建失败: ${JSON.stringify(sku.json)}`);
      skuByKey[p.key] = sku.json.skuCode as string;
    }
    if (isNew) {
      await api("POST", `/supplier/products/${productCode}/submit`, {}, supplier.token);
      await api("POST", `/admin/products/${productCode}/review`, { decision: "APPROVE" }, adminToken);
      console.log(`  上架 ${productCode} ${p.name}`);
    } else console.log(`  已存在 ${productCode} ${p.name}`);

    const lots = await api("GET", "/supplier/inventory/lots", undefined, supplier.token);
    const lotNo = `LMDJH2026Q3-${p.key}`;
    if (!lots.json?.some?.((x: any) => x.lotNo === lotNo)) {
      const r = await api("POST", "/supplier/inventory/lots", {
        skuCode: skuByKey[p.key], lotNo, qty: p.lotQty, producedAt: "2026-07-01", expiresAt: "2026-08-30",
      }, supplier.token);
      if (r.status >= 400) throw new Error(`库存批次创建失败 ${lotNo}: ${JSON.stringify(r.json)}`);
    }
  }

  console.log("5. 待付款订单（10KG = €2,850）");
  const orders = await api("GET", "/buyer/orders", undefined, buyer.token);
  let orderCode: string | undefined = orders.json?.find?.((o: any) => o.notes?.includes?.(CONTRACT_NO))?.code;
  if (!orderCode) {
    const placed = await api("POST", "/buyer/orders", {
      items: PRODUCTS.map((p) => ({ skuCode: skuByKey[p.key]!, qty: p.orderQty })),
      currency: "EUR",
    }, buyer.token);
    orderCode = placed.json?.orders?.[0]?.code as string | undefined;
    if (!orderCode) throw new Error(`下单失败: ${JSON.stringify(placed.json)}`);
    console.log(`  订单 ${orderCode} 已创建（PLACED，待付款——符合真实状态）`);
    await api("POST", "/documents", {
      docType: "SALES_CONTRACT", docNo: CONTRACT_NO, orderCode, issuer: "买卖双方双签", issueDate: "2026-07-12",
    }, supplier.token);
  } else console.log(`  订单 ${orderCode} 已存在，跳过创建`);

  console.log("6. 回写真实时间线与条款备注");
  const order = await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: orderCode } });
  await prisma.tradeOrder.update({
    where: { id: order.id },
    data: {
      placedAt: new Date("2026-07-12T09:00:00Z"),
      notes: `真实案例：合同 ${CONTRACT_NO}。付款条款：买方支付全部货款后，卖方收到货款 7 日内发货；` +
        `发货期为签约后 60 天左右（预计 2026-09-12），广州/长沙直飞巴黎 CDG。` +
        `CITES 证预计发货前 60 天办妥（当前资质档案中为 PENDING）。规格：盐度 3.5%，粒径 ≥2.8mm，` +
        `50g 马口铁罐 5kg + 500g 礼盒装 5kg。`,
    },
  });

  console.log(`\n✅ 良美东江湖供应商导入完成：
  供应商 supplier-d@demo.oussouri（${supplier.orgCode}）｜订单 ${orderCode}（待付款）
  合同 ${CONTRACT_NO} | 产品 2 个（€${PRICE_EUR}/kg，含 20 项营养成分与品鉴数据）| 基地 1 个
  身份防火墙：品牌名与厂址仅内部可见，公开产品页只展示工艺与品质数据。
  待补充：信用代码/法人/SC 证号/CITES 证号/银行信息/AWB（见文档文末清单）。`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
