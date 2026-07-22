/* eslint-disable no-console */
/**
 * P2.3-2.5 冒烟：
 * 3) 单证脱敏发送：无模板拒发 → 标注遮盖 → 生成追踪码副本 → 买家档案可见
 * 4) 溯源：基地→子单元→原料批次→用药休药期守卫→加工→QC→入库关联→公开脱敏溯源
 * 5) 代理外呼：登记联系人→Broker 外呼（响应无号码）→回调更新时长→通话记录
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

async function main(): Promise<void> {
  const run = Date.now();

  console.log("0. 账号准备");
  await ensureUser("admin@oussouri.local", ["ADMIN", "SUPER_ADMIN", "FINANCE"], "Ops Admin", "AdminDev2026!!");
  await ensureUser("broker@oussouri.local", ["BROKER"], "Broker One", "BrokerDev2026!!");
  const adminToken = await login("admin@oussouri.local", "AdminDev2026!!");
  const brokerToken = await login("broker@oussouri.local", "BrokerDev2026!!");

  const supplierEmail = `xsup${run}@test.local`;
  const buyerEmail = `xbuy${run}@test.local`;
  const supplierReg = await api("POST", "/auth/register", {
    email: supplierEmail, password: "Supplier2026!!", displayName: "X Supplier", partyType: "SUPPLIER",
    companyName: `X Supplier ${run}`, countryIso2: "CN",
  });
  const buyerReg = await api("POST", "/auth/register", {
    email: buyerEmail, password: "BuyerDev2026!!", displayName: "X Buyer", partyType: "BUYER",
    companyName: `X Buyer ${run}`, countryIso2: "FR", buyerType: "RESTAURANT",
  });
  for (const code of [supplierReg.json.orgCode, buyerReg.json.orgCode]) {
    await api("POST", `/admin/parties/${code}/approve`, { decision: "APPROVE" }, adminToken);
  }
  const supplierToken = await login(supplierEmail, "Supplier2026!!");
  const buyerToken = await login(buyerEmail, "BuyerDev2026!!");

  console.log("1. P2.4 溯源链");
  const unit = await api("POST", "/supplier/production-units", {
    unitType: "FARM", name: "黑金河鲟鳇鱼养殖基地", location: "黑龙江省佳木斯市汤原县黑金河",
    countryIso2: "CN", attributes: { waterSource: "天然山泉水", farmType: "POND" },
  }, supplierToken);
  check("登记基地（名称加密存储）", Boolean(unit.json?.unitId), unit.json);
  const subunit = await api("POST", `/supplier/production-units/${unit.json.unitId}/subunits`, { name: "1号亲鱼池", attributes: { areaM2: 5000 } }, supplierToken);
  const batch = await api("POST", "/supplier/source-batches", {
    subunitId: subunit.json.subunitId, batchNo: `HZB-BATCH-${run}`, speciesCode: "DAU", quantity: 500, ageMonths: 96, originType: "人工繁育",
  }, supplierToken);
  check("原料批次登记", Boolean(batch.json?.sourceBatchId), batch.json);

  const medNoWithdrawal = await api("POST", `/supplier/source-batches/${batch.json.sourceBatchId}/care-records`, {
    recordType: "MEDICATION", recordDate: new Date().toISOString(), payload: { medication: "抗生素A" },
  }, supplierToken);
  check("用药记录缺休药期被拒", medNoWithdrawal.status === 409, medNoWithdrawal.json);

  const futureWithdrawal = new Date(Date.now() + 10 * 86400000).toISOString();
  await api("POST", `/supplier/source-batches/${batch.json.sourceBatchId}/care-records`, {
    recordType: "MEDICATION", recordDate: new Date().toISOString(), payload: { medication: "抗生素A" }, withdrawalUntil: futureWithdrawal,
  }, supplierToken);
  const blockedProcessing = await api("POST", "/supplier/processing-batches", {
    sourceBatchId: batch.json.sourceBatchId, batchNo: `PROC-${run}A`, categoryCode: "CAVIAR", speciesCode: "DAU",
    rawWeightKg: 500, outputWeightKg: 50, processedAt: new Date().toISOString(),
  }, supplierToken);
  check("休药期内加工被拒（STATE_GUARD_FAILED）", blockedProcessing.status === 409 && blockedProcessing.json?.code === "STATE_GUARD_FAILED", blockedProcessing.json);

  // 把休药期改为已过（模拟时间流逝）
  await prisma.careRecord.updateMany({
    where: { sourceBatchId: batch.json.sourceBatchId, recordType: "MEDICATION" },
    data: { withdrawalUntil: new Date(Date.now() - 86400000) },
  });
  const processing = await api("POST", "/supplier/processing-batches", {
    sourceBatchId: batch.json.sourceBatchId, batchNo: `PROC-${run}`, categoryCode: "CAVIAR", speciesCode: "DAU",
    rawWeightKg: 500, outputWeightKg: 50, processedAt: new Date().toISOString(),
    steps: [{ stepCode: "EGG_SORTING" }, { stepCode: "SALTING", temperature: 4 }, { stepCode: "CANNING" }, { stepCode: "AGING" }],
  }, supplierToken);
  check("休药期过后加工成功（4 工序）", Boolean(processing.json?.processingBatchId), processing.json);
  await api("POST", `/admin/processing-batches/${processing.json.processingBatchId}/qc`, { qcStatus: "QC_PASS" }, adminToken);

  const product = await api("POST", "/supplier/products", {
    categoryCode: "CAVIAR", speciesCode: "DAU", hsCode: "1604310000", originCountry: "CN", name: "溯源链鱼子酱",
  }, supplierToken);
  const sku = await api("POST", `/supplier/products/${product.json.code}/skus`, {
    packSpec: "50g", netWeightKg: 0.05, unit: "TIN", moq: 1, priceTiers: [{ currency: "EUR", qtyMin: 0, unitPrice: 350 }],
  }, supplierToken);
  await api("POST", `/supplier/products/${product.json.code}/submit`, {}, supplierToken);
  await api("POST", `/admin/products/${product.json.code}/review`, { decision: "APPROVE" }, adminToken);
  const inbound = await api("POST", "/supplier/inventory/lots", {
    skuCode: sku.json.skuCode, lotNo: `XLOT${run}`, qty: 50, producedAt: "2026-07-01", expiresAt: "2026-09-30",
    processingBatchNo: `PROC-${run}`,
  }, supplierToken);
  check("入库关联加工批次", Number(inbound.json?.qtyOnHand) === 50, inbound.json);

  const trace = await api("GET", `/products/${product.json.code}/trace`);
  check("公开溯源链可见（品种/鱼龄/工序/得率）", trace.json?.chain?.source?.ageMonths === 96 && trace.json?.chain?.processing?.steps?.length === 4, trace.json);
  const traceLeak = JSON.stringify(trace.json).includes("黑金河") || JSON.stringify(trace.json).includes("佳木斯");
  check("公开溯源不泄露基地名/位置", !traceLeak);

  console.log("2. P2.3 单证脱敏发送");
  const doc = await api("POST", "/documents", { docType: "TEST_REPORT", docNo: `PONY-${run}`, orderCode: await firstOrderCode(buyerToken, sku.json.skuCode) }, supplierToken);
  check("检测报告登记", Boolean(doc.json?.documentId), doc.json);
  const sendNoTemplate = await api("POST", `/documents/${doc.json.documentId}/masked-copies`, { toOrgCode: buyerReg.json.orgCode }, brokerToken);
  check("未标注遮盖模板禁止外发", sendNoTemplate.status === 409, sendNoTemplate.json);
  await api("POST", `/documents/${doc.json.documentId}/mask-template`, {
    regions: [{ page: 1, x: 40, y: 60, w: 200, h: 50, label: "供应商公章" }, { page: 1, x: 40, y: 10, w: 300, h: 30, label: "企业名称" }],
  }, brokerToken);
  const sent = await api("POST", `/documents/${doc.json.documentId}/masked-copies`, { toOrgCode: buyerReg.json.orgCode }, brokerToken);
  check("脱敏副本生成（追踪码）", sent.json?.trackingCode?.startsWith("TRK-"), sent.json);
  const received = await api("GET", "/documents/received", undefined, buyerToken);
  check("买家档案可见副本", received.json?.some?.((d: any) => d.trackingCode === sent.json.trackingCode), received.json);
  const notices = await api("GET", "/notifications", undefined, buyerToken);
  check("买家收到 DOC_RECEIVED 通知", notices.json?.some?.((n: any) => n.templateCode === "DOC_RECEIVED"));

  console.log("3. P2.5 代理外呼");
  await api("POST", "/party/contacts", { name: "主厨", phone: "+33 7 49 88 49 70", isPrimary: true }, buyerToken);
  const call = await api("POST", "/broker/calls", { targetOrgCode: buyerReg.json.orgCode }, brokerToken);
  check("外呼发起", call.json?.status === "DIALING", call.json);
  check("响应不含电话号码", !JSON.stringify(call.json).includes("49 88") && !JSON.stringify(call.json).includes("+33"), call.json);
  const callLog = await prisma.callLog.findUnique({ where: { id: call.json.callId } });
  await api("POST", "/webhooks/twilio/call-status", { CallSid: callLog!.providerCallId, CallStatus: "completed", CallDuration: "192" });
  const calls = await api("GET", "/broker/calls", undefined, brokerToken);
  const myCall = calls.json?.find?.((c: any) => c.callId === call.json.callId);
  check("回调更新时长与结果", myCall?.durationSec === 192 && myCall?.outcome === "CONNECTED", myCall);
  check("通话记录仅含组织代码", myCall?.targetOrgCode === buyerReg.json.orgCode);

  await finishSmoke(prisma, run, failures);

  console.log(failures === 0 ? "\n✅ P2.3-2.5 冒烟全部通过" : `\n❌ ${failures} 项失败`);
  process.exitCode = failures === 0 ? 0 : 1;

  async function firstOrderCode(buyerTok: string, skuCode: string): Promise<string> {
    const placed = await api("POST", "/buyer/orders", { items: [{ skuCode, qty: 5 }], currency: "EUR" }, buyerTok);
    return placed.json.orders[0].code as string;
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
