/* eslint-disable no-console */
/**
 * B 组合规运营冒烟（R1-5 / R1-7 / R1.6-3）：
 * 1) 证照到期扫描：分档提醒、过期自动置 EXPIRED、重跑幂等
 * 2) GDPR：EXPORT 申请→审批→限时下载→内容自检；重复申请拒绝；DELETE 匿名化后不可登录
 * 3) 单证像素级打码：上传原件→标注遮盖→生成副本→收件方下载→遮盖区像素为黑
 *
 * 前置：API 跑在 localhost:3001，库已 seed。
 */
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

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
  const enc = Buffer.concat([c.update(v, "utf8"), c.final()]); // 必须先 final() 再取 authTag
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

async function raw(path: string, token: string): Promise<{ status: number; buffer: Buffer; contentType: string }> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
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
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

async function main(): Promise<void> {
  const run = Date.now();

  console.log("0. 账号准备");
  await ensureUser("admin@oussouri.local", ["ADMIN", "SUPER_ADMIN", "FINANCE"], "Ops Admin", "AdminDev2026!!");
  const adminToken = await login("admin@oussouri.local", "AdminDev2026!!");

  const supplierEmail = `csup${run}@test.local`;
  const buyerEmail = `cbuy${run}@test.local`;
  const supplierReg = await api("POST", "/auth/register", {
    email: supplierEmail, password: "Supplier2026!!", displayName: "C Supplier", partyType: "SUPPLIER",
    companyName: `C Supplier ${run}`, countryIso2: "CN",
  });
  const buyerReg = await api("POST", "/auth/register", {
    email: buyerEmail, password: "BuyerDev2026!!", displayName: "C Buyer", partyType: "BUYER",
    companyName: `C Buyer ${run}`, countryIso2: "FR", buyerType: "RESTAURANT",
  });
  for (const code of [supplierReg.json.orgCode, buyerReg.json.orgCode]) {
    await api("POST", `/admin/parties/${code}/approve`, { decision: "APPROVE" }, adminToken);
  }
  const supplierToken = await login(supplierEmail, "Supplier2026!!");
  const buyerToken = await login(buyerEmail, "BuyerDev2026!!");
  const supplierOrg = await prisma.organization.findFirstOrThrow({ where: { publicCode: supplierReg.json.orgCode } });

  // ---------- 1. R1-5 证照到期扫描 ----------
  console.log("\n1. R1-5 证照到期扫描");
  const certSpecs = [
    { certType: `HACCP-${run}`, days: -1 },
    { certType: `EU-APPROVAL-${run}`, days: 5 },
    { certType: `ISO22000-${run}`, days: 20 },
    { certType: `FAR-FUTURE-${run}`, days: 200 },
  ];
  for (const spec of certSpecs) {
    await prisma.partyCertificate.create({
      data: { orgId: supplierOrg.id, certType: spec.certType, certNo: `${spec.certType}-NO`, expiryDate: inDays(spec.days), status: "VALID" },
    });
  }

  const mine = await api("GET", "/compliance/certificates/expiring/mine", undefined, supplierToken);
  const mineTypes = (mine.json ?? []).map((c: any) => c.certType);
  check("本组织到期清单含 60 天内三张证", certSpecs.slice(0, 3).every((s) => mineTypes.includes(s.certType)), mineTypes);
  check("200 天后到期的证不在清单内", !mineTypes.includes(`FAR-FUTURE-${run}`));
  const buckets = new Map((mine.json ?? []).map((c: any) => [c.certType, c.bucket]));
  check("分档正确（-1→EXPIRED / 5→7 / 20→30）",
    buckets.get(`HACCP-${run}`) === "EXPIRED" && buckets.get(`EU-APPROVAL-${run}`) === "7" && buckets.get(`ISO22000-${run}`) === "30",
    Object.fromEntries(buckets));

  const scan1 = await api("POST", "/compliance/certificates/scan", {}, adminToken);
  check("扫描执行成功", scan1.status === 201 && scan1.json?.scanned >= 3, scan1.json);
  const expiredCert = await prisma.partyCertificate.findFirstOrThrow({ where: { orgId: supplierOrg.id, certType: `HACCP-${run}` } });
  check("已过期证自动置 EXPIRED", expiredCert.status === "EXPIRED", expiredCert.status);
  const notStale = await prisma.partyCertificate.findFirstOrThrow({ where: { orgId: supplierOrg.id, certType: `ISO22000-${run}` } });
  check("未到期证保持 VALID", notStale.status === "VALID", notStale.status);

  const supplierNotices = await api("GET", "/notifications", undefined, supplierToken);
  const certNotices = (supplierNotices.json ?? []).filter((n: any) => n.templateCode === "CERT_EXPIRING");
  check("供应商收到三档到期提醒", certNotices.length === 3, certNotices.map((n: any) => n.payload?.dedupeKey));
  const adminNotices = await api("GET", "/notifications", undefined, adminToken);
  check("内部合规角色收到当日汇总", (adminNotices.json ?? []).some((n: any) => n.templateCode === "CERT_EXPIRY_DIGEST"));

  const scan2 = await api("POST", "/compliance/certificates/scan", {}, adminToken);
  check("重跑幂等：不再重复发提醒", scan2.json?.notified === 0 && scan2.json?.expired === 0, scan2.json);

  const forbidden = await api("GET", "/compliance/certificates/expiring", undefined, supplierToken);
  check("全平台到期清单对供应商关闭", forbidden.status === 403, forbidden.json);

  // ---------- 2. R1-7 GDPR ----------
  console.log("\n2. R1-7 GDPR 数据主体请求");
  const exportReq = await api("POST", "/compliance/gdpr/requests", { requestType: "EXPORT", reason: "annual check" }, buyerToken);
  check("买家发起导出请求", Boolean(exportReq.json?.requestId), exportReq.json);
  const dupe = await api("POST", "/compliance/gdpr/requests", { requestType: "EXPORT" }, buyerToken);
  check("同类型重复申请被拒", dupe.status === 409, dupe.json);
  const selfApprove = await api("POST", `/compliance/gdpr/requests/${exportReq.json.requestId}/approve`, {}, buyerToken);
  check("本人不能自批", selfApprove.status === 403, selfApprove.json);

  const queue = await api("GET", "/compliance/gdpr/requests", undefined, adminToken);
  check("请求进入管理员待办", (queue.json ?? []).some((r: any) => r.id === exportReq.json.requestId));
  const approved = await api("POST", `/compliance/gdpr/requests/${exportReq.json.requestId}/approve`, {}, adminToken);
  check("批准后返回一次性下载令牌", typeof approved.json?.downloadToken === "string" && approved.json.bytes > 0, approved.json);

  const download = await raw(`/compliance/gdpr/exports/${approved.json.downloadToken}`, buyerToken);
  check("本人可下载导出包", download.status === 200 && download.contentType.includes("json"), download.status);
  const bundle = JSON.parse(download.buffer.toString("utf8"));
  check("导出包含本人邮箱与档案", bundle?.profile?.email === buyerEmail, bundle?.profile?.email);
  check("导出包含所属组织", (bundle?.organizations ?? []).some((o: any) => o.publicCode === buyerReg.json.orgCode));
  check("导出包含审计与通知段", Array.isArray(bundle?.auditLogs) && Array.isArray(bundle?.notifications));
  const otherDownload = await raw(`/compliance/gdpr/exports/${approved.json.downloadToken}`, supplierToken);
  check("他人持令牌也取不到（身份双校验）", otherDownload.status === 403, otherDownload.status);

  const stale = await api("POST", `/compliance/gdpr/requests/${exportReq.json.requestId}/approve`, {}, adminToken);
  check("已处理请求不可重复批准", stale.status === 409, stale.json);

  // 删除权：用一个独立的、无组织在途订单的账号
  const gonerEmail = `cgone${run}@test.local`;
  await ensureUser(gonerEmail, ["GUEST"], "To Be Erased", "Goner2026!!");
  const gonerToken = await login(gonerEmail, "Goner2026!!");
  const delReq = await api("POST", "/compliance/gdpr/requests", { requestType: "DELETE", reason: "close account" }, gonerToken);
  const delDone = await api("POST", `/compliance/gdpr/requests/${delReq.json.requestId}/approve`, {}, adminToken);
  check("删除请求执行完成", delDone.json?.status === "COMPLETED", delDone.json);
  const byOldEmail = await prisma.user.findFirst({ where: { emailBidx: bidx(gonerEmail) } });
  check("原邮箱盲索引已被替换", byOldEmail === null, byOldEmail?.id);
  check("匿名化报告记录了清理项", typeof delDone.json?.erasureReport?.sessionsRevoked === "number", delDone.json?.erasureReport);
  const reLogin = await api("POST", "/auth/login", { email: gonerEmail, password: "Goner2026!!" });
  check("匿名化后无法登录", reLogin.status === 401 || reLogin.status === 403, reLogin.status);

  // ---------- 3. R1.6-3 像素级打码 ----------
  console.log("\n3. R1.6-3 单证像素级打码");
  const doc = await prisma.document.create({
    data: {
      docType: "TEST_REPORT", docNo: `PONY-${run}`, ownerOrgId: supplierOrg.id,
      fileKey: `pending-upload/${run}`, status: "VALID",
    },
  });
  // 红底图：200×100，遮盖 (10,10,40,20) 后该处必须变黑
  const original = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  const form = new FormData();
  form.append("file", new Blob([original], { type: "image/png" }), "report.png");
  const upload = await fetch(`${BASE}/documents/${doc.id}/file`, { method: "POST", headers: { Authorization: `Bearer ${supplierToken}` }, body: form });
  check("原件上传成功", upload.status === 201, await upload.text().catch(() => ""));

  await api("POST", `/documents/${doc.id}/mask-template`, {
    regions: [{ page: 1, x: 10, y: 10, w: 40, h: 20, label: "供应商公章" }],
  }, adminToken);
  const sent = await api("POST", `/documents/${doc.id}/masked-copies`, { toOrgCode: buyerReg.json.orgCode }, adminToken);
  check("副本已真实渲染（非仅元数据）", sent.json?.rendered === true && sent.json?.regionsApplied === 1, sent.json);

  const received = await api("GET", "/documents/received", undefined, buyerToken);
  const entry = (received.json ?? []).find((d: any) => d.trackingCode === sent.json.trackingCode);
  check("买家档案可见副本且标记有产物", entry?.hasFile === true, entry);
  check("档案不泄露原件对象键", !JSON.stringify(received.json).includes("documents/"), received.json);

  const copyFile = await raw(`/documents/received/${sent.json.trackingCode}/file`, buyerToken);
  check("买家可下载脱敏副本", copyFile.status === 200, copyFile.status);
  const { data, info } = await sharp(copyFile.buffer).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const o = (y * info.width + x) * info.channels;
    return [data[o], data[o + 1], data[o + 2]];
  };
  check("遮盖区像素为黑（像素级脱敏生效）", px(20, 15).every((v) => v === 0), px(20, 15));
  check("遮盖区外像素保持原样", px(150, 15)[0] === 255 && px(150, 15)[1] === 0, px(150, 15));

  const originalByBuyer = await raw(`/documents/${doc.id}/file`, buyerToken);
  check("买家取不到原件（身份防火墙）", originalByBuyer.status === 403, originalByBuyer.status);

  console.log(failures === 0 ? "\n✅ B 组合规冒烟全部通过" : `\n❌ ${failures} 项失败`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
