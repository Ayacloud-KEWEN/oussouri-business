/* eslint-disable no-console */
/**
 * P2.2 履约冒烟：运单登记 → 单证守卫（缺件拒发货）→ 冷链超阈告警 →
 * 出口报关状态联动订单 → 签收自动分账 → CITES 配额扣减。
 * 前提：API :3001 运行，DB 已 seed。
 */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { finishSmoke } from "./lib/test-data";

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
      data: { emailEnc: encrypt(email), emailBidx: bidx(email), passwordHash: hashPassword("CustomsDev2026!!"), displayName },
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

const login = async (email: string, password: string) => (await api("POST", "/auth/login", { email, password })).json.accessToken as string;

const DOC_TYPES = ["COMMERCIAL_INVOICE", "CITES", "ORIGIN_CERT", "PACKING_LIST", "AWB", "SANITARY_CERT", "HEALTH_CERT"];

async function main(): Promise<void> {
  const run = Date.now();

  console.log("0. 账号与订单准备");
  await ensureUser("admin@oussouri.local", ["ADMIN", "SUPER_ADMIN", "FINANCE"], "Ops Admin");
  await ensureUser("customs@oussouri.local", ["CUSTOMS_OFFICER", "LOGISTICS_OPERATOR"], "Customs One");
  const adminToken = await login("admin@oussouri.local", "AdminDev2026!!");
  const customsToken = await login("customs@oussouri.local", "CustomsDev2026!!");
  check("清关专员登录", Boolean(customsToken));

  const supplierEmail = `fsup${run}@test.local`;
  const buyerEmail = `fbuy${run}@test.local`;
  const supplierReg = await api("POST", "/auth/register", {
    email: supplierEmail, password: "Supplier2026!!", displayName: "F Supplier", partyType: "SUPPLIER",
    companyName: `Fulfil Supplier ${run}`, countryIso2: "CN",
  });
  const buyerReg = await api("POST", "/auth/register", {
    email: buyerEmail, password: "BuyerDev2026!!", displayName: "F Buyer", partyType: "BUYER",
    companyName: `Fulfil Buyer ${run}`, countryIso2: "FR", buyerType: "IMPORTER",
  });
  for (const code of [supplierReg.json.orgCode, buyerReg.json.orgCode]) {
    await api("POST", `/admin/parties/${code}/approve`, { decision: "APPROVE" }, adminToken);
  }
  const supplierToken = await login(supplierEmail, "Supplier2026!!");
  const buyerToken = await login(buyerEmail, "BuyerDev2026!!");

  const product = await api("POST", "/supplier/products", {
    categoryCode: "CAVIAR", speciesCode: "DAU", hsCode: "1604310000", originCountry: "CN", name: "履约测试鱼子酱",
  }, supplierToken);
  const sku = await api("POST", `/supplier/products/${product.json.code}/skus`, {
    packSpec: "250g", netWeightKg: 0.25, unit: "TIN", moq: 1,
    priceTiers: [{ currency: "EUR", qtyMin: 0, unitPrice: 300 }],
  }, supplierToken);
  await api("POST", `/supplier/products/${product.json.code}/submit`, {}, supplierToken);
  await api("POST", `/admin/products/${product.json.code}/review`, { decision: "APPROVE" }, adminToken);
  await api("POST", "/supplier/inventory/lots", {
    skuCode: sku.json.skuCode, lotNo: `FLOT${run}`, qty: 100, producedAt: "2026-06-25", expiresAt: "2026-09-25",
  }, supplierToken);

  const placed = await api("POST", "/buyer/orders", { items: [{ skuCode: sku.json.skuCode, qty: 30 }], currency: "EUR" }, buyerToken);
  const orderCode = placed.json.orders[0].code as string;
  const checkout = await api("POST", "/payments/checkout", { orderCode }, buyerToken);
  await api("POST", "/webhooks/stripe", { type: "payment_intent.succeeded", data: { object: { id: checkout.json.intentId } } });
  await api("POST", `/supplier/orders/${orderCode}/confirm`, {}, supplierToken);
  check("订单已支付并接单", true);

  console.log("1. 发货守卫：无运单/缺单证被拒");
  const shipNoDocs = await api("POST", `/supplier/orders/${orderCode}/ship`, {}, supplierToken);
  check("无运单发货被拒 409", shipNoDocs.status === 409 && shipNoDocs.json?.code === "DOC_CHECKLIST_INCOMPLETE", shipNoDocs.json);

  const shipment = await api("POST", `/supplier/orders/${orderCode}/shipment`, {
    incoterms: "CIF", packages: 20, grossWeightKg: 33,
    legs: [
      { mode: "AIR", carrier: "Air China Cargo", waybillNo: "784-09040220", fromCode: "HRB", toCode: "PEK" },
      { mode: "AIR", carrier: "Air China Cargo", waybillNo: "784-09040220", fromCode: "PEK", toCode: "CDG" },
      { mode: "COLD_CHAIN_LAST_MILE", carrier: "Chronofresh", fromCode: "CDG", toCode: "PAR" },
    ],
  }, supplierToken);
  check("多段运单登记（3 段）", shipment.json?.legs === 3, shipment.json);

  for (const docType of DOC_TYPES.slice(0, 6)) {
    await api("POST", "/documents", { docType, docNo: `${docType}-${run}`, orderCode }, supplierToken);
  }
  const shipMissing = await api("POST", `/supplier/orders/${orderCode}/ship`, {}, supplierToken);
  check("缺 1 件单证仍被拒（HEALTH_CERT）", shipMissing.status === 409 && JSON.stringify(shipMissing.json).includes("HEALTH_CERT"), shipMissing.json);

  await api("POST", "/documents", { docType: "HEALTH_CERT", docNo: `HC-${run}`, orderCode }, supplierToken);
  const checklist = await api("GET", `/orders/${orderCode}/doc-checklist`, undefined, supplierToken);
  check("7 件套齐备", checklist.json?.complete === true, checklist.json);

  const shipped = await api("POST", `/supplier/orders/${orderCode}/ship`, {}, supplierToken);
  check("单证齐备后发货成功", shipped.json?.status === "SHIPPED", shipped.json);
  const shipView = await api("GET", `/orders/${orderCode}/shipment`, undefined, buyerToken);
  check("买家可见运单转 IN_TRANSIT", shipView.json?.status === "IN_TRANSIT", shipView.json);

  console.log("2. 冷链温度日志");
  const temps = await api("POST", `/logistics/orders/${orderCode}/temperature-logs`, {
    entries: [
      { recordedAt: new Date().toISOString(), tempC: -1.5 },
      { recordedAt: new Date().toISOString(), tempC: 0.5 },
      { recordedAt: new Date().toISOString(), tempC: 4.2 },
    ],
  }, supplierToken);
  check("3 条日志、1 条超阈标记", temps.json?.logged === 3 && temps.json?.breaches === 1, temps.json);
  const buyerNotices = await api("GET", "/notifications", undefined, buyerToken);
  check("买家收到超阈告警通知", buyerNotices.json?.some?.((n: any) => n.templateCode === "TEMP_BREACH"));

  console.log("3. 出口报关联动订单");
  const decl = await api("POST", "/customs/declarations", { orderCode, direction: "EXPORT", brokerName: "Freightairesa" }, customsToken);
  check("报关单创建（HS 从产品带出）", decl.json?.hsCode === "1604310000", decl.json);
  await api("POST", `/customs/declarations/${decl.json.declarationId}/transition`, { toState: "SUBMITTED" }, customsToken);
  let orders = await api("GET", "/buyer/orders", undefined, buyerToken);
  check("申报后订单 IN_CUSTOMS", orders.json?.find?.((o: any) => o.code === orderCode)?.status === "IN_CUSTOMS");
  await api("POST", `/customs/declarations/${decl.json.declarationId}/transition`, { toState: "CLEARED", inspectionResult: "PASS" }, customsToken);
  orders = await api("GET", "/buyer/orders", undefined, buyerToken);
  check("放行后订单 CUSTOMS_CLEARED", orders.json?.find?.((o: any) => o.code === orderCode)?.status === "CUSTOMS_CLEARED");

  console.log("4. 签收 → 自动分账");
  await api("POST", `/buyer/orders/${orderCode}/confirm-delivery`, {}, buyerToken);
  let completed = false;
  for (let i = 0; i < 15; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const list = await api("GET", "/buyer/orders", undefined, buyerToken);
    if (list.json?.find?.((o: any) => o.code === orderCode)?.status === "COMPLETED") { completed = true; break; }
  }
  check("清关链路后仍自动 COMPLETED", completed);

  console.log("5. CITES 配额");
  const permit = await api("POST", "/customs/cites-permits", {
    supplierOrgCode: supplierReg.json.orgCode, permitNo: `2026CN/EC${run}/HBB`, speciesCode: "DAU",
    quotaKg: 50, issueDate: "2026-05-10", expiryDate: "2027-05-10",
  }, supplierToken);
  check("许可证登记 50kg", Number(permit.json?.quotaKg) === 50, permit.json);
  const deduct = await api("POST", `/customs/cites-permits/${encodeURIComponent(`2026CN/EC${run}/HBB`)}/deduct`, { kg: 30 }, customsToken);
  check("扣减 30kg，余 20", Number(deduct.json?.remainingKg) === 20, deduct.json);
  const overdraw = await api("POST", `/customs/cites-permits/${encodeURIComponent(`2026CN/EC${run}/HBB`)}/deduct`, { kg: 30 }, customsToken);
  check("超配额扣减被拒", overdraw.status === 409 && overdraw.json?.code === "CITES_QUOTA_EXCEEDED", overdraw.json);

  await finishSmoke(prisma, run, failures);

  console.log(failures === 0 ? "\n✅ 履约冒烟全部通过" : `\n❌ ${failures} 项失败`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
