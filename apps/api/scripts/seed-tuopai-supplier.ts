/* eslint-disable no-console */
/**
 * 真实供应商导入：黑龙江拓派生物科技有限公司（源：HZB/养殖基地信息入库2.docx，2026-07-16）
 * 全国 7 家具备鲟鳇鱼产品出口资质企业之一；中国鱼子酱对俄出口最大供应商（80% 份额）。
 *
 * 建立：主体与工商档案 → 3 联系人 → 5 项资质 → CITES 2026CN/EC00042/HBB（双物种）→
 * 5 个养殖基地（云南临沧网箱×4区/山东临朐RAS/湖北南漳RAS/黑龙江长岭湖/辽宁）→
 * 2 产品（西伯利亚鲟 €310 / 杂交鲟「赫哲传承级」€325）→ 库存 →
 * 进行中订单 ORD-20260708-001（合同 TP-FR-202601，52KG €16,735，30% 定金已付，备货中）。
 * 另：华芝宝补 3 个 globalsales 邮箱联系人；2025 版 CITES 证标记过期。
 *
 * 可重复执行（幂等）。前提：PG + API 已启动。
 *   npx tsx scripts/seed-tuopai-supplier.ts
 */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.DEMO_API_BASE ?? "http://localhost:3001/v1";
const PASSWORD = "Demo2026!Caviar";
const prisma = new PrismaClient();

// ---------- helpers（与 seed-hzb-case.ts 一致） ----------
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

// ---------- 案例常量（全部取自入库文档） ----------
const CONTRACT_NO = "TP-FR-202601";
const CITES_NO = "2026CN/EC00042/HBB"; // 2026-07-16 签发，2027-01-11 到期；BAE 11kg + 杂交鲟 41kg

const FARMS = [
  {
    name: "云南临沧生态网箱养殖场", location: "云南省临沧市", unitType: "FARM",
    attributes: { farmType: "CAGE", areaMu: 2000, waterSource: "天然水域" },
    subunits: ["1号养殖区", "2号养殖区", "3号养殖区", "4号养殖区"].map((n) => ({ name: n, attributes: { capacityTons: 500 } })),
  },
  {
    name: "山东临朐陆地流水养殖场", location: "山东省临朐县", unitType: "FARM",
    attributes: { farmType: "RAS", areaM2: 10000, waterSource: "流水" },
    subunits: [{ name: "流水车间", attributes: {} }],
  },
  {
    name: "湖北南漳陆地流水养殖场", location: "湖北省南漳县", unitType: "FARM",
    attributes: { farmType: "RAS", areaM2: 10000, waterSource: "流水" },
    subunits: [{ name: "流水车间", attributes: {} }],
  },
  {
    name: "黑龙江长岭湖冷水养殖基地", location: "黑龙江省哈尔滨市长岭湖", unitType: "FARM",
    attributes: { farmType: "POND", areaMu: 500, waterSource: "冷水", waterTempMin: 4, waterTempMax: 18 },
    subunits: [{ name: "冷水亲鱼池", attributes: {} }],
  },
  {
    name: "辽宁养殖基地", location: "辽宁省", unitType: "FARM",
    attributes: { farmType: "PENDING", note: "详细信息待补充" },
    subunits: [{ name: "养殖区", attributes: {} }],
  },
] as const;

// 产品 × 订单行（发票口径：BAE 6+5=11kg @310；HYB 6+5+30=41kg @325 → €16,735）
const PRODUCTS = [
  {
    key: "BAE", name: "西伯利亚鲟鱼子酱（拓派）", species: "BAE", grade: "G002", price: 310,
    desc: "西伯利亚鲟（Acipenser baerii）鱼子酱，标准级，籽粒 2.8–3.0mm。产地黑龙江哈尔滨，全国七家鲟鳇鱼出口资质企业之一出品。",
    lotQty: 15, orderQtys: [6, 5],
  },
  {
    key: "HYB", name: "杂交鲟鱼子酱·赫哲传承级（达氏鳇×史氏鲟）", species: "DAUSCH", grade: "G001", price: 325,
    desc: "达氏鳇×史氏鲟杂交鱼子酱，赫哲传承级，籽粒 3.0–3.2mm。对俄出口市场份额第一的黑龙江工厂出品。",
    lotQty: 45, orderQtys: [6, 5, 30],
  },
] as const;

async function main(): Promise<void> {
  console.log(`目标 API: ${BASE}\n=== 真实供应商：黑龙江拓派生物科技（合同 ${CONTRACT_NO}）===\n1. 主体`);
  const OPS = "demo-ops@oussouri.local";
  await ensureOpsAdmin(OPS);
  const adminToken = await login(OPS);

  const supplier = await ensureParty({
    email: "supplier-c@demo.oussouri", displayName: "拓派水产", partyType: "SUPPLIER",
    companyName: "黑龙江拓派生物科技有限公司", countryIso2: "CN",
  }, adminToken);
  const buyer = await ensureParty({
    email: "buyer-a@demo.oussouri", displayName: "Jinglin Achats", partyType: "BUYER",
    companyName: "SAS JINGLIN PARIS", countryIso2: "FR", buyerType: "IMPORTER",
  }, adminToken);
  console.log(`  供应商 ${supplier.orgCode}（拓派），买家 ${buyer.orgCode}（B-FR-0001 → JINGLIN）`);

  // 工商档案（加密列直写：注册号/法人/地址）+ 供应商画像
  const org = await prisma.organization.findFirstOrThrow({ where: { publicCode: supplier.orgCode } });
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      registrationNoEnc: encrypt("91230109MA1C34CG42"),
      legalRepEnc: encrypt("郭凯军"),
      addressEnc: encrypt("黑龙江省哈尔滨市道里区航空制造产业园17号楼"),
      riskNotes: "全国7家具备鲟鳇鱼产品出口资质企业之一；中国鱼子酱对俄出口最大供应商（80% 市场份额）。",
    },
  });
  await prisma.supplierProfile.upsert({
    where: { orgId: org.id },
    create: {
      orgId: org.id, establishedAt: new Date("2020-05-08"), registeredCapital: 10_000_000,
      businessScope: "鲟鳇鱼苗种繁育、养殖、肉制品及鱼子酱加工、市场营销、进出口贸易", tier: "T1", exportReady: true,
    },
    update: { establishedAt: new Date("2020-05-08"), registeredCapital: 10_000_000, exportReady: true },
  });

  console.log("2. 联系人（拓派 3 人 + 华芝宝 3 邮箱）");
  const TUOPAI_CONTACTS = [
    { name: "郭凯军", position: "法定代表人/总经理", phone: "18645439444", email: "tuopaishuichan@163.com", isPrimary: true },
    { name: "宋涛", position: "企业负责人/对外发言人", isPrimary: false },
    { name: "徐洪亮", position: "业务负责人", isPrimary: false },
  ];
  const existingContacts = await prisma.contact.count({ where: { orgId: org.id, deletedAt: null } });
  if (existingContacts === 0) {
    for (const c of TUOPAI_CONTACTS) {
      await prisma.contact.create({
        data: {
          orgId: org.id, nameEnc: encrypt(c.name), positionEnc: encrypt(c.position),
          phoneEnc: c.phone ? encrypt(c.phone) : undefined, emailEnc: c.email ? encrypt(c.email) : undefined,
          isPrimary: c.isPrimary,
        },
      });
    }
  }
  const hzbOrg = await prisma.organization.findFirst({
    where: { legalNameBidx: bidx("黑龙江华芝宝生物科技有限公司"), deletedAt: null },
  });
  if (hzbOrg && (await prisma.contact.count({ where: { orgId: hzbOrg.id, deletedAt: null } })) === 0) {
    for (const [i, email] of ["globalsales1@hzb-caviar.com", "globalsales2@hzb-caviar.com", "globalsales3@hzb-caviar.com"].entries()) {
      await prisma.contact.create({
        data: { orgId: hzbOrg.id, nameEnc: encrypt(`海外销售 ${i + 1}（姓名待补充）`), positionEnc: encrypt("Global Sales"), emailEnc: encrypt(email), isPrimary: i === 0 },
      });
    }
    console.log("  华芝宝 3 个 globalsales 联系人已补");
  }

  console.log("3. 资质证书 + CITES 配额");
  const CERTS = [
    { certType: "EXPORT_LICENSE", certNo: "PENDING-EXPORT", issuer: "海关总署（全国7家鲟鳇鱼出口资质企业之一，证号待补充）" },
    { certType: "SC", certNo: "PENDING-SC", issuer: "黑龙江省市场监督管理局（食品生产许可证，证号待补充）" },
    { certType: "HACCP", certNo: "PENDING-HACCP", issuer: "认证机构待补充" },
    { certType: "ISO22000", certNo: "PENDING-ISO22000", issuer: "认证机构待补充" },
  ];
  for (const c of CERTS) {
    const exist = await prisma.partyCertificate.findFirst({ where: { orgId: org.id, certType: c.certType, deletedAt: null } });
    if (!exist) await prisma.partyCertificate.create({ data: { orgId: org.id, certType: c.certType, certNo: c.certNo, issuer: c.issuer, status: "VALID" } });
  }
  for (const p of [{ species: "BAE", kg: 11 }, { species: "DAUSCH", kg: 41 }]) {
    const permitNo = `${CITES_NO}/${p.species === "DAUSCH" ? "DAUxSCH" : p.species}`;
    const r = await api("POST", "/customs/cites-permits", {
      supplierOrgCode: supplier.orgCode, permitNo, speciesCode: p.species, quotaKg: p.kg,
      issueDate: "2026-07-16", expiryDate: "2027-01-11",
    }, adminToken);
    console.log(`  ${permitNo}（${p.kg}kg）${r.status < 400 ? "就绪" : "已存在/跳过"}`);
  }
  // 华芝宝 2025 版 CITES 已过有效期（2026-05-10）→ 标记过期
  const expired = await prisma.citesPermit.updateMany({
    where: { permitNo: { startsWith: "2025CN/EC00017/HBB" }, status: "VALID" },
    data: { status: "EXPIRED" },
  });
  if (expired.count > 0) console.log(`  华芝宝 2025 版 CITES ×${expired.count} 已标记 EXPIRED`);

  console.log("4. 养殖基地（5 个）");
  const units = await api("GET", "/supplier/production-units", undefined, supplier.token);
  const haveUnits = new Set<string>();
  // 生产单元名称加密存储，API 列表返回解密名（视权限）；以数量幂等
  if ((units.json?.length ?? 0) < FARMS.length) {
    for (const f of FARMS) {
      const unit = await api("POST", "/supplier/production-units", {
        unitType: f.unitType, name: f.name, location: f.location, countryIso2: "CN", attributes: f.attributes,
      }, supplier.token);
      if (!unit.json?.unitId) { console.warn(`  ⚠ 基地创建失败 ${f.name}: ${JSON.stringify(unit.json)}`); continue; }
      for (const s of f.subunits) {
        await api("POST", `/supplier/production-units/${unit.json.unitId}/subunits`, { name: s.name, attributes: s.attributes }, supplier.token);
      }
      haveUnits.add(f.name);
    }
    console.log(`  基地已建 ${haveUnits.size} 个（云南临沧含 4 个 500 吨养殖区）`);
  } else console.log("  基地已存在，跳过");

  console.log("5. 产品与库存（BAE €310 / 杂交鲟·赫哲传承级 €325）");
  const skuByKey: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const existing = await api("GET", "/supplier/products", undefined, supplier.token);
    let productCode: string | undefined = existing.json?.find?.((x: any) => x.name === p.name)?.code;
    let isNew = false;
    if (!productCode) {
      const created = await api("POST", "/supplier/products", {
        categoryCode: "CAVIAR", speciesCode: p.species, gradeCode: p.grade, hsCode: "1604310000", originCountry: "CN",
        name: p.name, description: p.desc,
      }, supplier.token);
      productCode = created.json.code as string;
      isNew = true;
    }
    const expected = `${productCode}-BULKKG`;
    const haveSkus = new Set((await prisma.productSku.findMany({
      where: { product: { publicCode: productCode }, deletedAt: null }, select: { skuCode: true },
    })).map((s) => s.skuCode));
    if (haveSkus.has(expected)) skuByKey[p.key] = expected;
    else {
      const sku = await api("POST", `/supplier/products/${productCode}/skus`, {
        packSpec: "bulk/kg", netWeightKg: 1, unit: "KG", moq: 1, shelfLifeDays: 60,
        priceTiers: [{ currency: "EUR", qtyMin: 0, unitPrice: p.price }],
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
    const lotNo = `TP2026Q3-${p.key}`;
    if (!lots.json?.some?.((x: any) => x.lotNo === lotNo)) {
      const r = await api("POST", "/supplier/inventory/lots", {
        skuCode: skuByKey[p.key], lotNo, qty: p.lotQty,
        producedAt: "2026-07-05", expiresAt: "2026-09-03",
      }, supplier.token);
      if (r.status >= 400) throw new Error(`库存批次创建失败 ${lotNo}: ${JSON.stringify(r.json)}`);
    }
  }

  console.log("6. 进行中订单（52KG = €16,735，备货中）");
  const orders = await api("GET", "/buyer/orders", undefined, buyer.token);
  let orderCode: string | undefined = orders.json?.find?.((o: any) => o.notes?.includes?.(CONTRACT_NO) || Number(o.itemsTotal ?? 0) === 16735)?.code;
  if (!orderCode) {
    // 下单接口一 SKU 一行：发票的多行按罐规拆分，这里按 SKU 合并（BAE 11kg + HYB 41kg，金额一致）
    const placed = await api("POST", "/buyer/orders", {
      items: PRODUCTS.map((p) => ({ skuCode: skuByKey[p.key]!, qty: p.orderQtys.reduce((s, q) => s + q, 0) })),
      currency: "EUR",
    }, buyer.token);
    orderCode = placed.json?.orders?.[0]?.code as string | undefined;
    if (!orderCode) throw new Error(`下单失败: ${JSON.stringify(placed.json)}`);
    console.log(`  订单 ${orderCode} 已创建`);

    // 真实条款为 30% 定金（€5,020.50 已付 Wise→哈尔滨银行）+ 尾款 30 天账期；
    // 系统当前仅支持全额托管（R1.5-1 分期付款落地后改造），以托管模拟并在备注注明。
    const checkout = await api("POST", "/payments/checkout", { orderCode }, buyer.token);
    await api("POST", "/webhooks/stripe", { type: "payment_intent.succeeded", data: { object: { id: checkout.json.intentId } } });
    await api("POST", `/supplier/orders/${orderCode}/confirm`, {}, supplier.token);

    // 备货中：登记运单（PEK→CDG，承运人订舱中）与已办妥的 CITES 单据；不发货
    await api("POST", `/supplier/orders/${orderCode}/shipment`, {
      incoterms: "CIF", packages: 4, grossWeightKg: 110,
      legs: [{ mode: "AIR", carrier: "订舱中（TBD Air Cargo）", fromCode: "PEK", toCode: "CDG" }],
    }, supplier.token);
    await api("POST", "/documents", {
      docType: "CITES", docNo: CITES_NO, orderCode,
      issuer: "中华人民共和国濒危物种进出口管理办公室", issueDate: "2026-07-16", expiryDate: "2027-01-11",
    }, supplier.token);
    await api("POST", "/documents", {
      docType: "SALES_CONTRACT", docNo: CONTRACT_NO, orderCode, issuer: "买卖双方双签", issueDate: "2026-06-30",
    }, supplier.token);
    // 出口报关建档（状态机要求发货后才能 SUBMITTED，先留 DRAFT）
    await api("POST", "/customs/declarations", { orderCode, direction: "EXPORT", brokerName: "申报准备中" }, adminToken);
  } else console.log(`  订单 ${orderCode} 已存在，跳过创建`);

  console.log("7. 回写真实时间线与条款备注");
  const order = await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: orderCode } });
  await prisma.tradeOrder.update({
    where: { id: order.id },
    data: {
      placedAt: new Date("2026-07-08T09:00:00Z"),
      incoterms: "CIF",
      notes: `真实案例：合同 ${CONTRACT_NO}（首批法国市场订单）。` +
        `付款条款：30% 定金 €5,020.50 已付（Wise 比利时 → 哈尔滨银行，2026-07-08），尾款 €11,714.50 账期 30 天` +
        `（系统当前以全额托管模拟，R1.5-1 分期付款上线后改造）。` +
        `CITES ${CITES_NO}（西伯利亚鲟 11kg + 杂交鲟 41kg，2027-01-11 到期）已办妥；空运 PEK→CDG 订舱中。`,
    },
  });

  console.log(`\n✅ 拓派供应商导入完成：
  供应商 supplier-c@demo.oussouri（${supplier.orgCode}）｜订单 ${orderCode}（CONFIRMED 备货中）
  合同 ${CONTRACT_NO} | CITES ${CITES_NO}（11+41kg 未核销） | 基地 5 个 | 产品 2 个
  待补充清单见 HZB/养殖基地信息入库2.docx 文末（信用代码实缴/SC证号/HACCP证号/存鱼量/AWB）。`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
