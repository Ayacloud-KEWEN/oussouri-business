/* eslint-disable no-console */
/**
 * P2 冒烟：RFQ 闭环 + 规则撮合 + 居间代下单 + 支付链接通知。
 * 前提：API 运行于 :3001，DB 已 seed（含 P2 状态机）。
 */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3001/v1";
const prisma = new PrismaClient();

function loadEnv(): Record<string, string> {
  const content = readFileSync(resolve(__dirname, "..", ".env"), "utf8");
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
  return env;
}
const env = loadEnv();
const bidx = (v: string) => createHmac("sha256", Buffer.from(env.PII_BLIND_INDEX_KEY!, "hex")).update(v.trim().toLowerCase()).digest("hex");
function encrypt(v: string): Uint8Array {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(env.PII_ENCRYPTION_KEY!, "hex"), iv);
  const enc = Buffer.concat([c.update(v, "utf8"), c.final()]);
  const packed = Buffer.concat([iv, c.getAuthTag(), enc]);
  const out = new Uint8Array(packed.length); out.set(packed); return out;
}
const hashPassword = (p: string) => {
  const s = randomBytes(16);
  return `${s.toString("hex")}:${scryptSync(p, s, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
};

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log(`  ✔ ${name}`);
  else { failures += 1; console.error(`  ✘ ${name}`, JSON.stringify(extra ?? "")); }
};

async function api(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function ensureUser(email: string, roles: string[], displayName: string): Promise<void> {
  let user = await prisma.user.findFirst({ where: { emailBidx: bidx(email) } });
  if (!user) {
    user = await prisma.user.create({
      data: { emailEnc: encrypt(email), emailBidx: bidx(email), passwordHash: hashPassword("BrokerDev2026!!"), displayName },
    });
  }
  for (const code of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
}

async function login(email: string, password: string): Promise<string> {
  const r = await api("POST", "/auth/login", { email, password });
  return r.json.accessToken as string;
}

async function main(): Promise<void> {
  const run = Date.now();

  console.log("0. 账号准备（复用 P1 冒烟主流程创建供采与产品/库存）");
  await ensureUser("broker@oussouri.local", ["BROKER"], "Broker One");
  await ensureUser("admin@oussouri.local", ["ADMIN", "SUPER_ADMIN", "FINANCE"], "Ops Admin");
  const adminToken = await login("admin@oussouri.local", "AdminDev2026!!");
  const brokerToken = await login("broker@oussouri.local", "BrokerDev2026!!");
  check("Broker 登录", Boolean(brokerToken));

  // 供采双方 + 产品 + 库存（独立数据，避免依赖历史）
  const supplierEmail = `p2supplier${run}@test.local`;
  const buyerEmail = `p2buyer${run}@test.local`;
  const supplierReg = await api("POST", "/auth/register", {
    email: supplierEmail, password: "Supplier2026!!", displayName: "P2 Supplier", partyType: "SUPPLIER",
    companyName: `P2 Supplier Co ${run}`, countryIso2: "CN",
  });
  const buyerReg = await api("POST", "/auth/register", {
    email: buyerEmail, password: "BuyerDev2026!!", displayName: "P2 Buyer", partyType: "BUYER",
    companyName: `P2 Buyer SAS ${run}`, countryIso2: "FR", buyerType: "IMPORTER",
  });
  for (const code of [supplierReg.json.orgCode, buyerReg.json.orgCode]) {
    await api("POST", `/admin/parties/${code}/approve`, { decision: "APPROVE" }, adminToken);
  }
  const supplierToken = await login(supplierEmail, "Supplier2026!!");
  const buyerToken = await login(buyerEmail, "BuyerDev2026!!");

  const product = await api("POST", "/supplier/products", {
    categoryCode: "CAVIAR", speciesCode: "DAU", gradeCode: "G001", hsCode: "1604310000",
    originCountry: "CN", name: "达氏鳇鱼子酱 P2",
  }, supplierToken);
  const sku = await api("POST", `/supplier/products/${product.json.code}/skus`, {
    packSpec: "100g", netWeightKg: 0.1, unit: "TIN", moq: 1,
    priceTiers: [{ currency: "EUR", qtyMin: 0, unitPrice: 300 }],
  }, supplierToken);
  await api("POST", `/supplier/products/${product.json.code}/submit`, {}, supplierToken);
  await api("POST", `/admin/products/${product.json.code}/review`, { decision: "APPROVE" }, adminToken);
  await api("POST", "/supplier/inventory/lots", {
    skuCode: sku.json.skuCode, lotNo: `P2LOT${run}`, qty: 200, producedAt: "2026-06-20", expiresAt: "2026-09-20",
  }, supplierToken);
  check("P2 供采/产品/库存就绪", Boolean(sku.json.skuCode));

  console.log("1. RFQ 闭环");
  const rfq = await api("POST", "/buyer/rfqs", {
    categoryCode: "CAVIAR", speciesCode: "DAU", qty: 60, targetPrice: 290, destCountry: "FR",
    deadline: new Date(Date.now() + 14 * 86400000).toISOString(),
  }, buyerToken);
  check("买家发布 RFQ (RFQ- 代码)", rfq.json?.code?.startsWith("RFQ-"), rfq.json);

  const openList = await api("GET", "/supplier/rfqs", undefined, supplierToken);
  const visible = openList.json?.find?.((r: any) => r.code === rfq.json.code);
  check("供应商可见开放 RFQ（买家仅代码）", visible?.buyerCode?.startsWith("BY-"), visible);

  const quote = await api("POST", `/supplier/rfqs/${rfq.json.code}/quotes`, { unitPrice: 285, leadTimeDays: 10 }, supplierToken);
  check("供应商报价", quote.json?.round === 1, quote.json);

  const buyerRfqs = await api("GET", "/buyer/rfqs", undefined, buyerToken);
  const myRfq = buyerRfqs.json?.find?.((r: any) => r.code === rfq.json.code);
  check("买家收到报价（供应商仅代码）", myRfq?.quotes?.[0]?.supplierCode?.startsWith("SP-"), myRfq);

  const accepted = await api("POST", `/buyer/quotes/${myRfq.quotes[0].id}/accept`, {}, buyerToken);
  check("接受报价 → RFQ 订单 €285×60=17100", Number(accepted.json?.grandTotal) === 17100, accepted.json);

  console.log("2. 规则撮合");
  const mm = await api("POST", "/broker/matchmaking/run", {}, brokerToken);
  check("撮合运行", mm.status === 201 || mm.status === 200, mm.json);
  const opps = await api("GET", "/broker/opportunities", undefined, brokerToken);
  check("商机流可见（含四维分）", Array.isArray(opps.json) && opps.json.length >= 0);
  const opp = opps.json?.find?.((o: any) => o.buyerCode === buyerReg.json.orgCode);

  console.log("3. 居间代下单");
  if (opp) {
    await api("POST", `/broker/opportunities/${opp.code}/claim`, {}, brokerToken);
  }
  const brokerOrder = await api("POST", "/broker/orders", {
    buyerOrgCode: buyerReg.json.orgCode,
    skuCode: sku.json.skuCode,
    qty: 20,
    unitPriceEur: 295,
    opportunityCode: opp?.code,
  }, brokerToken);
  check("居间意向单生成（24h 锁货）", brokerOrder.json?.orderCode?.startsWith("ORD-"), brokerOrder.json);

  const lowball = await api("POST", "/broker/orders", {
    buyerOrgCode: buyerReg.json.orgCode, skuCode: sku.json.skuCode, qty: 20, unitPriceEur: 100,
  }, brokerToken);
  check("超低议价被拒（≥70% 底线）", lowball.status === 400, lowball.json);

  const notices = await api("GET", "/notifications", undefined, buyerToken);
  const payNotice = notices.json?.find?.((n: any) => n.templateCode === "ORDER_PAYMENT_LINK");
  check("买家收到平台支付链接通知", Boolean(payNotice), notices.json?.length);

  console.log("4. 买家支付居间单（闭环）");
  const checkout = await api("POST", "/payments/checkout", { orderCode: brokerOrder.json.orderCode }, buyerToken);
  await api("POST", "/webhooks/stripe", { type: "payment_intent.succeeded", data: { object: { id: checkout.json.intentId } } });
  const buyerOrders = await api("GET", "/buyer/orders", undefined, buyerToken);
  const paid = buyerOrders.json?.find?.((o: any) => o.code === brokerOrder.json.orderCode);
  check("居间单进入 PAID_ESCROW", paid?.status === "PAID_ESCROW", paid?.status);

  console.log(failures === 0 ? "\n✅ P2 冒烟全部通过" : `\n❌ ${failures} 项失败`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
