/* eslint-disable no-console */
/**
 * 一键演示数据（docs/demo-preparation.md 的自动化版）：
 * 账号(2供2买+运营) → 5产品(程序生成珠粒图) → 溯源链 → 库存 →
 * 6笔不同状态订单 → RFQ+报价 → 撮合商机 → 联系人 → 客服会话 → 脱敏单证。
 * 可重复执行（幂等：已存在的数据跳过）。
 *
 * 本地:  npx tsx scripts/seed-demo.ts        （API 需运行在 :3001）
 * VPS:   docker compose -f infra/docker-compose.cloudpanel.yml --env-file .env.production \
 *          exec api npx tsx scripts/seed-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateCaviarImage } from "./demo/png";

const BASE = process.env.DEMO_API_BASE ?? "http://localhost:3001/v1";
const PASSWORD = "Demo2026!Caviar";
const prisma = new PrismaClient();

// ---------- env / crypto helpers（容器内走 process.env，本地回退 .env 文件） ----------
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

/** 注册（已存在则直接登录），返回 { token, orgCode } */
async function ensureParty(input: {
  email: string; displayName: string; partyType: "SUPPLIER" | "BUYER";
  companyName: string; countryIso2: string; buyerType?: string;
}, adminToken: string): Promise<{ token: string; orgCode: string }> {
  const reg = await api("POST", "/auth/register", { ...input, password: PASSWORD, locale: "zh-CN" });
  if (reg.json?.orgCode) {
    await api("POST", `/admin/parties/${reg.json.orgCode}/approve`, { decision: "APPROVE" }, adminToken);
    return { token: await login(input.email), orgCode: reg.json.orgCode as string };
  }
  // 已存在：登录取 orgCode
  const token = await login(input.email);
  const me = await api("GET", "/auth/me", undefined, token);
  return { token, orgCode: me.json.orgCode as string };
}

const DOC_TYPES = ["COMMERCIAL_INVOICE", "CITES", "ORIGIN_CERT", "PACKING_LIST", "AWB", "SANITARY_CERT", "HEALTH_CERT"];

async function shipPrep(orderCode: string, supplierToken: string, tag: string): Promise<void> {
  await api("POST", `/supplier/orders/${orderCode}/shipment`, {
    incoterms: "CIF", packages: 20, grossWeightKg: 40,
    legs: [
      { mode: "AIR", carrier: "Air China Cargo", waybillNo: "784-09040220", fromCode: "HRB", toCode: "PEK" },
      { mode: "AIR", carrier: "Air China Cargo", waybillNo: "784-09040220", fromCode: "PEK", toCode: "CDG" },
    ],
  }, supplierToken);
  for (const docType of DOC_TYPES) {
    await api("POST", "/documents", { docType, docNo: `${docType}-${tag}`, orderCode }, supplierToken);
  }
}

type Stage = "PLACED" | "PAID" | "SHIPPED" | "FULL";

async function makeOrder(opts: { buyerToken: string; supplierToken: string; skuCode: string; qty: number; stage: Stage; tag: string }): Promise<string | null> {
  const placed = await api("POST", "/buyer/orders", { items: [{ skuCode: opts.skuCode, qty: opts.qty }], currency: "EUR" }, opts.buyerToken);
  const orderCode = placed.json?.orders?.[0]?.code as string | undefined;
  if (!orderCode) { console.warn(`  ⚠ 下单失败 ${opts.skuCode}:`, JSON.stringify(placed.json)); return null; }
  if (opts.stage === "PLACED") return orderCode;

  const checkout = await api("POST", "/payments/checkout", { orderCode }, opts.buyerToken);
  await api("POST", "/webhooks/stripe", { type: "payment_intent.succeeded", data: { object: { id: checkout.json.intentId } } });
  if (opts.stage === "PAID") return orderCode;

  await api("POST", `/supplier/orders/${orderCode}/confirm`, {}, opts.supplierToken);
  await shipPrep(orderCode, opts.supplierToken, opts.tag);
  await api("POST", `/supplier/orders/${orderCode}/ship`, {}, opts.supplierToken);
  if (opts.stage === "SHIPPED") return orderCode;

  await api("POST", `/buyer/orders/${orderCode}/confirm-delivery`, {}, opts.buyerToken);
  for (let i = 0; i < 15; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const list = await api("GET", "/buyer/orders", undefined, opts.buyerToken);
    if (list.json?.find?.((o: any) => o.code === orderCode)?.status === "COMPLETED") break;
  }
  return orderCode;
}

async function main(): Promise<void> {
  console.log(`目标 API: ${BASE}\n1. 账号`);
  const OPS = "demo-ops@oussouri.local";
  await ensureOpsAdmin(OPS);
  const adminToken = await login(OPS);

  const supplierA = await ensureParty({ email: "supplier-a@demo.oussouri", displayName: "华芝宝运营", partyType: "SUPPLIER", companyName: "黑龙江华芝宝生物科技有限公司", countryIso2: "CN" }, adminToken);
  const supplierB = await ensureParty({ email: "supplier-b@demo.oussouri", displayName: "千岛湖运营", partyType: "SUPPLIER", companyName: "杭州千岛湖鲟龙科技股份有限公司", countryIso2: "CN" }, adminToken);
  const buyerA = await ensureParty({ email: "buyer-a@demo.oussouri", displayName: "Jinglin Achats", partyType: "BUYER", companyName: "SAS JINGLIN PARIS", countryIso2: "FR", buyerType: "IMPORTER" }, adminToken);
  const buyerB = await ensureParty({ email: "buyer-b@demo.oussouri", displayName: "Chef Bruno", partyType: "BUYER", companyName: "Maison Bruno Milan SRL", countryIso2: "IT", buyerType: "RESTAURANT" }, adminToken);
  console.log(`  供应商 ${supplierA.orgCode}/${supplierB.orgCode}，买家 ${buyerA.orgCode}/${buyerB.orgCode}`);

  console.log("2. 溯源链（供应商 A）");
  const existingBatches = await api("GET", "/supplier/processing-batches", undefined, supplierA.token);
  let procBatchNo = "HZBSC-DEMO-01";
  if (!existingBatches.json?.some?.((b: any) => b.batchNo === procBatchNo)) {
    const unit = await api("POST", "/supplier/production-units", {
      unitType: "FARM", name: "黑金河鲟鳇鱼养殖基地", location: "黑龙江省佳木斯市汤原县黑金河",
      countryIso2: "CN", attributes: { waterSource: "天然山泉水", farmType: "POND" },
    }, supplierA.token);
    const subunit = await api("POST", `/supplier/production-units/${unit.json.unitId}/subunits`, { name: "1号亲鱼池", attributes: { areaM2: 5000 } }, supplierA.token);
    const source = await api("POST", "/supplier/source-batches", {
      subunitId: subunit.json.subunitId, batchNo: "HZB-BATCH-DEMO", speciesCode: "DAU", quantity: 500, ageMonths: 108, originType: "人工繁育",
    }, supplierA.token);
    const proc = await api("POST", "/supplier/processing-batches", {
      sourceBatchId: source.json.sourceBatchId, batchNo: procBatchNo, categoryCode: "CAVIAR", speciesCode: "DAU",
      rawWeightKg: 500, outputWeightKg: 52, processedAt: new Date().toISOString(),
      steps: [{ stepCode: "EGG_SORTING" }, { stepCode: "SALTING", temperature: 4 }, { stepCode: "CANNING" }, { stepCode: "AGING" }],
    }, supplierA.token);
    await api("POST", `/admin/processing-batches/${proc.json.processingBatchId}/qc`, { qcStatus: "QC_PASS" }, adminToken);
    console.log("  溯源链已建（基地→批次→加工→QC）");
  } else console.log("  已存在，跳过");

  console.log("3. 产品与图片");
  const PRODUCTS = [
    { owner: "A", name: "达氏鳇鱼子酱（帝王金）", species: "DAU", grade: "G001", pack: "100g", weight: 0.1, tiers: [{ qtyMin: 0, qtyMax: 50, unitPrice: 680 }, { qtyMin: 50, unitPrice: 620 }], stock: 120, trace: true },
    { owner: "A", name: "史氏鲟×达氏鳇杂交鱼子酱", species: "SCHDAU", grade: "G002", pack: "50g", weight: 0.05, tiers: [{ qtyMin: 0, qtyMax: 50, unitPrice: 320 }, { qtyMin: 50, unitPrice: 302 }], stock: 200, trace: false },
    { owner: "B", name: "西伯利亚鲟鱼子酱", species: "BAE", grade: "G003", pack: "100g", weight: 0.1, tiers: [{ qtyMin: 0, qtyMax: 50, unitPrice: 210 }, { qtyMin: 50, unitPrice: 195 }], stock: 180, trace: false },
    { owner: "B", name: "俄罗斯鲟鱼子酱（琥珀）", species: "GUE", grade: "G002", pack: "50g", weight: 0.05, tiers: [{ qtyMin: 0, qtyMax: 50, unitPrice: 380 }, { qtyMin: 50, unitPrice: 355 }], stock: 90, trace: false },
    { owner: "B", name: "欧洲鳇鱼子酱（Beluga）", species: "HUS", grade: "G001", pack: "100g", weight: 0.1, tiers: [{ qtyMin: 0, qtyMax: 30, unitPrice: 1450 }, { qtyMin: 30, unitPrice: 1320 }], stock: 60, trace: false },
  ] as const;

  const skuCodes: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const owner = p.owner === "A" ? supplierA : supplierB;
    const existing = await api("GET", "/supplier/products", undefined, owner.token);
    let productCode: string | undefined = existing.json?.find?.((x: any) => x.name === p.name)?.code;
    if (!productCode) {
      const created = await api("POST", "/supplier/products", {
        categoryCode: "CAVIAR", speciesCode: p.species, gradeCode: p.grade, hsCode: "1604310000", originCountry: "CN", name: p.name,
      }, owner.token);
      productCode = created.json.code as string;
      const sku = await api("POST", `/supplier/products/${productCode}/skus`, {
        packSpec: p.pack, netWeightKg: p.weight, unit: "TIN", moq: 1, priceTiers: [{ currency: "EUR", ...p.tiers[0] }, { currency: "EUR", ...p.tiers[1] }],
      }, owner.token);
      skuCodes[p.name] = sku.json.skuCode as string;
      // 程序生成珠粒风格产品图并上传
      const png = generateCaviarImage(p.species);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), `${p.species}.png`);
      const up = await fetch(`${BASE}/files/upload`, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: form });
      const upJson: any = await up.json();
      if (upJson?.key) await api("POST", `/supplier/products/${productCode}/media`, { key: upJson.key }, owner.token);
      await api("POST", `/supplier/products/${productCode}/submit`, {}, owner.token);
      await api("POST", `/admin/products/${productCode}/review`, { decision: "APPROVE" }, adminToken);
      console.log(`  上架 ${productCode} ${p.name}`);
    } else {
      skuCodes[p.name] = `${productCode}-${p.pack.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
      console.log(`  已存在 ${productCode} ${p.name}，跳过`);
    }
    // 库存（按固定批次号幂等）
    const lots = await api("GET", "/supplier/inventory/lots", undefined, owner.token);
    const lotNo = `DEMO-${p.species}`;
    if (!lots.json?.some?.((l: any) => l.lotNo === lotNo)) {
      await api("POST", "/supplier/inventory/lots", {
        skuCode: skuCodes[p.name], lotNo, qty: p.stock,
        producedAt: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10),
        expiresAt: new Date(Date.now() + 75 * 86400000).toISOString().slice(0, 10),
        ...(p.trace ? { processingBatchNo: procBatchNo } : {}),
      }, owner.token);
    }
  }

  console.log("4. 订单流水（不同状态）");
  const buyerOrders = await api("GET", "/buyer/orders", undefined, buyerA.token);
  if ((buyerOrders.json?.length ?? 0) < 4) {
    await makeOrder({ buyerToken: buyerA.token, supplierToken: supplierA.token, skuCode: skuCodes["史氏鲟×达氏鳇杂交鱼子酱"]!, qty: 50, stage: "FULL", tag: "D1" });
    await makeOrder({ buyerToken: buyerB.token, supplierToken: supplierB.token, skuCode: skuCodes["西伯利亚鲟鱼子酱"]!, qty: 40, stage: "FULL", tag: "D2" });
    await makeOrder({ buyerToken: buyerA.token, supplierToken: supplierA.token, skuCode: skuCodes["达氏鳇鱼子酱（帝王金）"]!, qty: 20, stage: "PAID", tag: "D3" });
    await makeOrder({ buyerToken: buyerB.token, supplierToken: supplierB.token, skuCode: skuCodes["俄罗斯鲟鱼子酱（琥珀）"]!, qty: 15, stage: "PAID", tag: "D4" });
    await makeOrder({ buyerToken: buyerA.token, supplierToken: supplierB.token, skuCode: skuCodes["欧洲鳇鱼子酱（Beluga）"]!, qty: 10, stage: "SHIPPED", tag: "D5" });
    await makeOrder({ buyerToken: buyerB.token, supplierToken: supplierA.token, skuCode: skuCodes["达氏鳇鱼子酱（帝王金）"]!, qty: 12, stage: "PLACED", tag: "D6" });
    console.log("  已创建 6 笔（2 完成 / 2 已付 / 1 在途 / 1 待付）");
  } else console.log("  已有订单，跳过");

  console.log("5. RFQ 与报价（现场演示：买家 B 接受报价）");
  const rfqs = await api("GET", "/buyer/rfqs", undefined, buyerB.token);
  if ((rfqs.json?.length ?? 0) === 0) {
    const rfq = await api("POST", "/buyer/rfqs", {
      categoryCode: "CAVIAR", speciesCode: "HUS", qty: 30, targetPrice: 1300, destCountry: "IT",
      deadline: new Date(Date.now() + 14 * 86400000).toISOString(),
    }, buyerB.token);
    await api("POST", `/supplier/rfqs/${rfq.json.code}/quotes`, { unitPrice: 1350, leadTimeDays: 12 }, supplierB.token);
    console.log(`  RFQ ${rfq.json.code} 已发布并有 1 条报价（未接受，留给现场）`);
  } else console.log("  已存在，跳过");

  console.log("6. 撮合商机 + 联系人 + 会话 + 脱敏单证");
  await api("POST", "/party/contacts", { name: "Chef Bruno", phone: "+39 340 123 4567", isPrimary: true }, buyerB.token).catch(() => null);
  const mm = await api("POST", "/broker/matchmaking/run", {}, adminToken);
  console.log(`  撮合运行，新商机 ${mm.json?.created ?? 0} 条`);

  const conv = await api("POST", "/conversations", { topicType: "SUPPORT" }, buyerA.token);
  await api("POST", `/conversations/${conv.json.conversationId}/messages`, { body: "请问帝王金等级的最小起订量和交期？" }, buyerA.token);
  await api("POST", `/conversations/${conv.json.conversationId}/messages`, { body: "另外能否提供最新的欧盟卫生检疫报告？" }, buyerA.token);

  const received = await api("GET", "/documents/received", undefined, buyerA.token);
  if ((received.json?.length ?? 0) === 0) {
    const fullOrder = (await api("GET", "/buyer/orders", undefined, buyerA.token)).json?.find?.((o: any) => o.status === "COMPLETED");
    if (fullOrder) {
      const doc = await api("POST", "/documents", { docType: "TEST_REPORT", docNo: "PONY-2026-0701", orderCode: fullOrder.code }, supplierA.token);
      await api("POST", `/documents/${doc.json.documentId}/mask-template`, {
        regions: [{ page: 1, x: 40, y: 40, w: 220, h: 60, label: "供应商公章" }, { page: 1, x: 40, y: 10, w: 320, h: 28, label: "企业名称" }],
      }, adminToken);
      const sent = await api("POST", `/documents/${doc.json.documentId}/masked-copies`, { toOrgCode: buyerA.orgCode }, adminToken);
      console.log(`  脱敏检测报告已送达买家 A（追踪码 ${sent.json?.trackingCode}）`);
    }
  }

  console.log(`\n✅ 演示数据就绪。账号（密码统一 ${PASSWORD}）：
  运营主控  ${OPS}（全部内部角色）
  供应商 A  supplier-a@demo.oussouri（${supplierA.orgCode}）
  供应商 B  supplier-b@demo.oussouri（${supplierB.orgCode}）
  买家 A    buyer-a@demo.oussouri（${buyerA.orgCode}）
  买家 B    buyer-b@demo.oussouri（${buyerB.orgCode}）
现场演示保留动作：接受 RFQ 报价 / 认领商机+外呼+代下单 / IM 发手机号看拦截。`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
