/* eslint-disable no-console */
/**
 * 端到端冒烟（Step 2 §4 验收基线 3/4/5 项）：
 * 注册 → 审核 → 上架 → 入库 → 下单 → 支付(假 Stripe webhook) → 确认 → 发货 → 签收 → 自动分账
 * 外加：IM 联系方式拦截、账本校验。
 * 运行前提：API 已在 localhost:3001 启动，DB 已 seed。
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

function encrypt(plaintext: string): Uint8Array {
  const key = Buffer.from(env.PII_ENCRYPTION_KEY!, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), enc]);
  const out = new Uint8Array(packed.length);
  out.set(packed);
  return out;
}
function bidx(value: string): string {
  return createHmac("sha256", Buffer.from(env.PII_BLIND_INDEX_KEY!, "hex")).update(value.trim().toLowerCase()).digest("hex");
}
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ✔ ${name}`);
  else {
    failures += 1;
    console.error(`  ✘ ${name}`, extra ?? "");
  }
}

async function api(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function ensureAdmin(email: string, roles: string[]): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { emailBidx: bidx(email) } });
  let userId = existing?.id;
  if (!userId) {
    const user = await prisma.user.create({
      data: { emailEnc: encrypt(email), emailBidx: bidx(email), passwordHash: hashPassword("AdminDev2026!!"), displayName: "Ops Admin" },
    });
    userId = user.id;
  }
  for (const code of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id },
      update: {},
    });
  }
}

async function main(): Promise<void> {
  const run = Date.now();
  const supplierEmail = `supplier${run}@test.local`;
  const buyerEmail = `buyer${run}@test.local`;
  const adminEmail = "admin@oussouri.local";

  console.log("1. 管理员账号");
  await ensureAdmin(adminEmail, ["ADMIN", "SUPER_ADMIN", "FINANCE"]);
  const adminLogin = await api("POST", "/auth/login", { email: adminEmail, password: "AdminDev2026!!" });
  check("管理员登录", adminLogin.status === 201 || adminLogin.status === 200, adminLogin.json);
  const adminToken = adminLogin.json.accessToken as string;

  console.log("2. 注册供采双方");
  const supplierReg = await api("POST", "/auth/register", {
    email: supplierEmail, password: "Supplier2026!!", displayName: "HZB Ops", partyType: "SUPPLIER",
    companyName: "黑龙江华芝宝生物科技有限公司", countryIso2: "CN",
  });
  check("供应商注册 (SP- 代码)", supplierReg.json?.orgCode?.startsWith("SP-"), supplierReg.json);
  const buyerReg = await api("POST", "/auth/register", {
    email: buyerEmail, password: "BuyerDev2026!!", displayName: "Jinglin Chef", partyType: "BUYER",
    companyName: "SAS JINGLIN PARIS", countryIso2: "FR", buyerType: "IMPORTER",
  });
  check("采购商注册 (BY- 代码)", buyerReg.json?.orgCode?.startsWith("BY-"), buyerReg.json);

  console.log("3. 入驻审核");
  for (const code of [supplierReg.json.orgCode, buyerReg.json.orgCode]) {
    const approve = await api("POST", `/admin/parties/${code}/approve`, { decision: "APPROVE" }, adminToken);
    check(`审核通过 ${code}`, approve.json?.status === "ACTIVE", approve.json);
  }

  const supplierLogin = await api("POST", "/auth/login", { email: supplierEmail, password: "Supplier2026!!" });
  const buyerLogin = await api("POST", "/auth/login", { email: buyerEmail, password: "BuyerDev2026!!" });
  const supplierToken = supplierLogin.json.accessToken as string;
  const buyerToken = buyerLogin.json.accessToken as string;

  console.log("4. 供应商上架产品");
  const product = await api("POST", "/supplier/products", {
    categoryCode: "CAVIAR", speciesCode: "SCHDAU", gradeCode: "G002", hsCode: "1604310000",
    originCountry: "CN", name: "史氏鲟×达氏鳇杂交鱼子酱",
  }, supplierToken);
  check("创建产品 (PRD- 代码)", product.json?.code?.startsWith("PRD-"), product.json);
  const productCode = product.json.code as string;
  const sku = await api("POST", `/supplier/products/${productCode}/skus`, {
    packSpec: "50g", netWeightKg: 0.05, unit: "TIN", moq: 1,
    priceTiers: [
      { currency: "EUR", qtyMin: 0, qtyMax: 50, unitPrice: 320 },
      { currency: "EUR", qtyMin: 50, unitPrice: 302 },
    ],
  }, supplierToken);
  check("创建 SKU + 阶梯价", Boolean(sku.json?.skuCode), sku.json);
  const skuCode = sku.json.skuCode as string;
  await api("POST", `/supplier/products/${productCode}/submit`, {}, supplierToken);
  const review = await api("POST", `/admin/products/${productCode}/review`, { decision: "APPROVE" }, adminToken);
  check("产品审核上架", review.json?.status === "ACTIVE", review.json);

  console.log("5. 入库");
  const inbound = await api("POST", "/supplier/inventory/lots", {
    skuCode, lotNo: "HZBSC20260601", qty: 100,
    producedAt: "2026-06-01", expiresAt: "2026-09-01",
  }, supplierToken);
  check("批次入库 100kg", Number(inbound.json?.qtyOnHand) === 100, inbound.json);

  console.log("6. 市场可见性（身份防火墙）");
  const publicList = await api("GET", "/products");
  const listed = publicList.json?.data?.find((p: any) => p.code === productCode);
  check("匿名目录可见产品", Boolean(listed));
  check("匿名仅见供应商代码", listed?.supplierCode?.startsWith("SP-"), listed);
  check("匿名不见价格", listed?.skus?.[0]?.priceTiers === "LOGIN_REQUIRED");
  const anyLeak = JSON.stringify(publicList.json).includes("华芝宝");
  check("公开响应无公司名泄露", !anyLeak);

  console.log("7. 下单（阶梯价 50kg 档 €302）");
  await api("POST", "/buyer/cart/items", { skuCode, qty: 50 }, buyerToken);
  const placed = await api("POST", "/buyer/orders", { items: [{ skuCode, qty: 50 }], currency: "EUR" }, buyerToken);
  const order = placed.json?.orders?.[0];
  check("订单生成 (ORD- 代码)", order?.code?.startsWith("ORD-"), placed.json);
  check("阶梯价命中 €302×50=15100", Number(order?.grandTotal) === 15100, order);
  const orderCode = order.code as string;

  console.log("8. 支付（假 Stripe → webhook）");
  const checkout = await api("POST", "/payments/checkout", { orderCode }, buyerToken);
  check("创建 PaymentIntent", Boolean(checkout.json?.intentId), checkout.json);
  const webhook = await api("POST", "/webhooks/stripe", {
    type: "payment_intent.succeeded",
    data: { object: { id: checkout.json.intentId } },
  });
  check("Webhook 处理", webhook.json?.received === true, webhook.json);

  console.log("9. 履约流转");
  const confirm = await api("POST", `/supplier/orders/${orderCode}/confirm`, {}, supplierToken);
  check("供应商接单 CONFIRMED", confirm.json?.status === "CONFIRMED", confirm.json);
  // P2.2 发货守卫：登记运单 + 7 件套单证
  await api("POST", `/supplier/orders/${orderCode}/shipment`, {
    incoterms: "CIF",
    legs: [{ mode: "AIR", carrier: "Air China Cargo", waybillNo: "784-09040220", fromCode: "HRB", toCode: "CDG" }],
  }, supplierToken);
  for (const docType of ["COMMERCIAL_INVOICE", "CITES", "ORIGIN_CERT", "PACKING_LIST", "AWB", "SANITARY_CERT", "HEALTH_CERT"]) {
    await api("POST", "/documents", { docType, docNo: `${docType}-${run}`, orderCode }, supplierToken);
  }
  const ship = await api("POST", `/supplier/orders/${orderCode}/ship`, {}, supplierToken);
  check("发货 SHIPPED（出库扣减）", ship.json?.status === "SHIPPED", ship.json);
  const deliver = await api("POST", `/buyer/orders/${orderCode}/confirm-delivery`, {}, buyerToken);
  check("买家签收 DELIVERED", deliver.json?.status === "DELIVERED", deliver.json);

  console.log("10. 等待 Outbox → 自动分账 → COMPLETED（约 6 秒）");
  let completed = false;
  for (let i = 0; i < 15; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const orders = await api("GET", "/buyer/orders", undefined, buyerToken);
    const o = orders.json?.find?.((x: any) => x.code === orderCode);
    if (o?.status === "COMPLETED") { completed = true; break; }
  }
  check("订单自动 COMPLETED（Escrow 释放）", completed);

  console.log("11. 账本校验（双分录）");
  const ledger = await api("GET", "/finance/ledger", undefined, adminToken);
  const entries = ledger.json?.data ?? [];
  const escrowCredit = entries.filter((e: any) => e.account === "ESCROW_HELD" && e.direction === "CREDIT").reduce((s: number, e: any) => s + Number(e.amount), 0);
  const commission = entries.find((e: any) => e.account === "PLATFORM_COMMISSION");
  const payable = entries.find((e: any) => e.account === "SUPPLIER_PAYABLE");
  check("托管入账 15100", escrowCredit >= 15100, escrowCredit);
  check("平台佣金 1208 (8%)", Number(commission?.amount) === 1208, commission);
  check("供应商应收 13892", Number(payable?.amount) === 13892, payable);

  console.log("12. 库存与预留");
  const lots = await api("GET", "/supplier/inventory/lots", undefined, supplierToken);
  const lot = lots.json?.find?.((l: any) => l.lotNo === "HZBSC20260601");
  check("发货后在库 50", Number(lot?.qtyOnHand) === 50, lot);
  check("预留清零", Number(lot?.qtyReserved) === 0, lot);

  console.log("13. IM 联系方式拦截");
  const conv = await api("POST", "/conversations", { topicType: "SUPPORT" }, buyerToken);
  const blocked = await api("POST", `/conversations/${conv.json.conversationId}/messages`, { body: "请直接联系我 +33 7 49 88 49 70" }, buyerToken);
  check("含电话消息被拦截 422", blocked.status === 422 && blocked.json?.code === "PII_BLOCKED", blocked.json);
  const okMsg = await api("POST", `/conversations/${conv.json.conversationId}/messages`, { body: "请问这批鱼子酱的颗粒大小？" }, buyerToken);
  check("正常消息可发送", Boolean(okMsg.json?.messageId), okMsg.json);

  console.log("14. 穿透审批");
  const esc = await api("POST", `/admin/parties/${buyerReg.json.orgCode}/escalations`, { fields: ["companyName"], reason: "开具增值税发票需要真实抬头" }, adminToken);
  check("低敏穿透即时放行", esc.json?.status === "APPROVED", esc.json);
  const sensitive = await api("GET", `/admin/parties/${buyerReg.json.orgCode}/sensitive?escalationId=${esc.json.escalationId}`, undefined, adminToken);
  check("解密读取公司名", sensitive.json?.companyName === "SAS JINGLIN PARIS", sensitive.json);

  console.log(failures === 0 ? "\n✅ 冒烟全部通过" : `\n❌ ${failures} 项失败`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
