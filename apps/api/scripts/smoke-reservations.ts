/* eslint-disable no-console */
/**
 * 过期预留回收冒烟。
 *
 * 先复现 bug：下单锁货 → 把预留 expiresAt 改到过去 → 确认在没有扫描器时库存被永久占住；
 * 再验证修复：跑一轮 sweep → 订单自动取消、qtyReserved 归零、可售量恢复。
 * 另覆盖两条不该误伤的路径：已付款订单不动、支付在途（PENDING）订单不动。
 *
 * 前置：API 跑在 localhost:3001，库已 seed。
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
  try { json = await res.json(); } catch { /* 空响应体 */ }
  return { status: res.status, json };
}

async function ensureUser(email: string, roles: string[], displayName: string, password: string): Promise<void> {
  let user = await prisma.user.findFirst({ where: { emailBidx: bidx(email) } });
  if (!user) {
    user = await prisma.user.create({
      data: { emailEnc: encrypt(email), emailBidx: bidx(email), passwordHash: hashPassword(password), displayName },
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

/** 把某订单的预留改成已过期（模拟 24h TTL 走完，无需真等） */
async function expireReservations(orderId: string): Promise<number> {
  const r = await prisma.reservation.updateMany({
    where: { refType: "ORDER", refId: orderId, status: "HELD" },
    data: { expiresAt: new Date(Date.now() - 3_600_000) },
  });
  return r.count;
}

const reservedQty = async (skuId: string): Promise<number> => {
  const lots = await prisma.inventoryLot.findMany({ where: { skuId, deletedAt: null } });
  return lots.reduce((sum, l) => sum + Number(l.qtyReserved), 0);
};

async function main(): Promise<void> {
  const run = Date.now();

  console.log("0. 账号与商品准备");
  await ensureUser("admin@oussouri.local", ["ADMIN", "SUPER_ADMIN", "FINANCE"], "Ops Admin", "AdminDev2026!!");
  const adminToken = await login("admin@oussouri.local", "AdminDev2026!!");

  const supplierEmail = `rsup${run}@test.local`;
  const buyerEmail = `rbuy${run}@test.local`;
  const supplierReg = await api("POST", "/auth/register", {
    email: supplierEmail, password: "Supplier2026!!", displayName: "R Supplier", partyType: "SUPPLIER",
    companyName: `X Supplier ${run}`, countryIso2: "CN",
  });
  const buyerReg = await api("POST", "/auth/register", {
    email: buyerEmail, password: "BuyerDev2026!!", displayName: "R Buyer", partyType: "BUYER",
    companyName: `X Buyer ${run}`, countryIso2: "FR", buyerType: "IMPORTER",
  });
  for (const code of [supplierReg.json.orgCode, buyerReg.json.orgCode]) {
    await api("POST", `/admin/parties/${code}/approve`, { decision: "APPROVE" }, adminToken);
  }
  const supplierToken = await login(supplierEmail, "Supplier2026!!");
  const buyerToken = await login(buyerEmail, "BuyerDev2026!!");

  const product = await api("POST", "/supplier/products", {
    categoryCode: "CAVIAR", speciesCode: "SCHDAU", gradeCode: "G002", hsCode: "1604310000",
    originCountry: "CN", name: "预留回收测试鱼子酱",
  }, supplierToken);
  const productCode = product.json.code as string;
  const sku = await api("POST", `/supplier/products/${productCode}/skus`, {
    packSpec: "50g", netWeightKg: 0.05, unit: "TIN", moq: 1,
    priceTiers: [{ currency: "EUR", qtyMin: 0, unitPrice: 300 }],
  }, supplierToken);
  const skuCode = sku.json.skuCode as string;
  await api("POST", `/supplier/products/${productCode}/submit`, {}, supplierToken);
  await api("POST", `/admin/products/${productCode}/review`, { decision: "APPROVE" }, adminToken);
  await api("POST", "/supplier/inventory/lots", {
    skuCode, lotNo: `RSV-${run}`, qty: 100, producedAt: "2026-06-01", expiresAt: "2027-06-01",
  }, supplierToken);
  const skuRow = await prisma.productSku.findFirstOrThrow({ where: { skuCode } });
  check("初始库存 100kg，预留为 0", (await reservedQty(skuRow.id)) === 0);

  // ---------- 1. 复现：过期预留占死库存 ----------
  console.log("\n1. 复现问题：锁货 TTL 到期但货没释放");
  const placed = await api("POST", "/buyer/orders", { items: [{ skuCode, qty: 30 }], currency: "EUR" }, buyerToken);
  const orderCode = placed.json.orders[0].code as string;
  const orderRow = await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: orderCode } });
  check("下单锁货 30kg", (await reservedQty(skuRow.id)) === 30);

  const held = await prisma.reservation.findMany({ where: { refType: "ORDER", refId: orderRow.id, status: "HELD" } });
  check("预留带 24h TTL", held.length > 0 && held.every((r) => r.expiresAt !== null), held.map((r) => r.expiresAt));

  const expiredCount = await expireReservations(orderRow.id);
  check("模拟 TTL 走完（预留置为过期）", expiredCount > 0);
  check("过期后货仍被锁住 —— 这就是修复前的永久泄漏", (await reservedQty(skuRow.id)) === 30);

  // ---------- 2. 验证修复 ----------
  console.log("\n2. 验证修复：sweep 回收过期预留");
  const sweep = await api("POST", "/admin/reservations/sweep", {}, adminToken);
  check("扫描执行成功", sweep.status === 201, sweep.json);
  check("超时订单被自动取消", sweep.json?.cancelledOrderCodes?.includes(orderCode), sweep.json);

  const afterOrder = await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: orderCode } });
  check("订单状态 → CANCELLED", afterOrder.status === "CANCELLED", afterOrder.status);
  check("库存预留已释放（可售量恢复）", (await reservedQty(skuRow.id)) === 0);
  const releasedRes = await prisma.reservation.findMany({ where: { refType: "ORDER", refId: orderRow.id } });
  check("预留记录标记为 RELEASED", releasedRes.every((r) => r.status === "RELEASED"), releasedRes.map((r) => r.status));
  const relTx = await prisma.inventoryTransaction.findMany({ where: { refType: "ORDER", refId: orderRow.id, txType: "RELEASE" } });
  check("留下 RELEASE 流水（可审计）", relTx.length > 0);

  const sweepAgain = await api("POST", "/admin/reservations/sweep", {}, adminToken);
  check("重跑幂等：无重复处理", sweepAgain.json?.ordersCancelled === 0 && sweepAgain.json?.orphansReleased === 0, sweepAgain.json);

  // ---------- 3. 不该误伤的路径 ----------
  console.log("\n3. 边界：已付款与支付在途的订单不得被扫掉");
  const paidOrder = await api("POST", "/buyer/orders", { items: [{ skuCode, qty: 10 }], currency: "EUR" }, buyerToken);
  const paidCode = paidOrder.json.orders[0].code as string;
  const paidRow = await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: paidCode } });
  const checkout = await api("POST", "/payments/checkout", { orderCode: paidCode }, buyerToken);
  const intentId = checkout.json?.intentId;
  await api("POST", "/webhooks/stripe", { type: "payment_intent.succeeded", data: { object: { id: intentId } } });
  const paidAfter = await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: paidCode } });
  check("订单已进入 PAID_ESCROW", paidAfter.status === "PAID_ESCROW", paidAfter.status);
  await expireReservations(paidRow.id);

  // 支付在途：建了 PENDING 支付但 webhook 未到
  const pendingOrder = await api("POST", "/buyer/orders", { items: [{ skuCode, qty: 5 }], currency: "EUR" }, buyerToken);
  const pendingCode = pendingOrder.json.orders[0].code as string;
  const pendingRow = await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: pendingCode } });
  await api("POST", "/payments/checkout", { orderCode: pendingCode }, buyerToken);
  await expireReservations(pendingRow.id);

  const sweep3 = await api("POST", "/admin/reservations/sweep", {}, adminToken);
  check("已付款订单未被取消", (await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: paidCode } })).status === "PAID_ESCROW");
  check("支付在途订单未被取消", (await prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: pendingCode } })).status === "PLACED", sweep3.json);
  check("支付在途被计入 skipped", sweep3.json?.skippedPendingPayment >= 1, sweep3.json);

  // ---------- 4. 账本不变量 ----------
  console.log("\n4. 账本不变量（本轮资金流）");
  const { checkLedgerInvariants } = await import("../src/modules/settlement/ledger-invariants");
  const rows = await prisma.ledgerEntry.findMany({
    where: { orderId: { in: [orderRow.id, paidRow.id, pendingRow.id] } },
    select: { journalId: true, account: true, direction: true, amount: true, currency: true, orderId: true },
  });
  check("本轮账本借贷平衡", checkLedgerInvariants(rows).length === 0, checkLedgerInvariants(rows));

  await finishSmoke(prisma, run, failures);

  console.log(failures === 0 ? "\n✅ 预留回收冒烟全部通过" : `\n❌ ${failures} 项失败`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
