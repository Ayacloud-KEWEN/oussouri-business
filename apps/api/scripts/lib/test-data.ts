/**
 * 测试数据识别与清除（供 clean-test-data.ts 与各 smoke 脚本共用）。
 *
 * 识别方式：组织法定名称走**加密列**，盲索引只能精确匹配，所以判定必须先解密再按模式匹配。
 * 所有模式都要求名称以 13 位时间戳结尾 —— 那是 smoke 脚本 `const run = Date.now()` 留下的印记，
 * 真实主体（华芝宝 / 拓派 / 良美 / WELLHOPE / JINGLIN…）与演示账号都不会命中。
 *
 * 删除方式：按外键依赖**从叶到根**，整体包在一个事务里。
 * 如果将来加了新表却忘了在这里补一刀，事务会因外键约束直接报错并整体回滚 ——
 * 宁可清理失败并明确报出哪张表挡路，也不要留下删了一半的库。
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { createDecipheriv, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** smoke 脚本创建的组织名模式；末尾 13 位时间戳是与真实数据的分界线 */
export const TEST_ORG_PATTERNS: RegExp[] = [
  /^X (Supplier|Buyer) \d{13}$/,
  /^C (Supplier|Buyer) \d{13}$/,
  /^P2 (Supplier Co|Buyer SAS) \d{13}$/,
  /^Fulfil (Supplier|Buyer) \d{13}$/,
  /^(Demo|Test) (Supplier|Buyer) \d{13}$/,
  /^HZB Supplier \d{13}$/,
  /^Jinglin Buyer \d{13}$/,
];

/** 历史遗留的一次性测试主体：无时间戳，只能按确切名称点名 */
export const LEGACY_TEST_ORG_NAMES: string[] = ["黑龙江测试审核公司"];

/**
 * smoke.ts 早期直接借用了真实公司名（只有邮箱带时间戳），于是每跑一次就多一对与真数据**同名**的主体。
 * 单看名字无法分辨真假，改用成员反查：真身的成员是下面这些固定邮箱的账号，smoke 副本的成员是
 * `sup{时间戳}@test.local` 之类的一次性账号。
 * smoke.ts 现已改为带时间戳命名，这条规则只用于清理历史积压。
 */
export const AMBIGUOUS_REAL_ORG_NAMES: string[] = ["黑龙江华芝宝生物科技有限公司", "SAS JINGLIN PARIS"];

/** 真实 seed 与演示账号使用的固定邮箱：挂着这些账号的主体一律不动 */
export const PROTECTED_EMAILS: string[] = [
  "demo-ops@oussouri.local",
  "admin@oussouri.local",
  "broker@oussouri.local",
  "customs@oussouri.local",
  "supplier-a@demo.oussouri",
  "supplier-b@demo.oussouri",
  "supplier-c@demo.oussouri",
  "supplier-d@demo.oussouri",
  "buyer-a@demo.oussouri",
  "buyer-b@demo.oussouri",
  "tuopaishuichan@163.com",
];

export function envVal(key: string): string {
  if (process.env[key]) return process.env[key]!;
  const file = resolve(__dirname, "..", "..", ".env");
  if (existsSync(file)) {
    const m = readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    if (m) return m[1]!.replace(/^"|"$/g, "");
  }
  throw new Error(`missing env ${key}`);
}

export function makeDecryptor(): (buf: Uint8Array | null) => string {
  const key = Buffer.from(envVal("PII_ENCRYPTION_KEY"), "hex");
  return (raw) => {
    if (!raw) return "";
    const buf = Buffer.from(raw);
    try {
      const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    } catch {
      return ""; // 密钥换过的历史脏数据，解不开就不当作测试数据处理
    }
  };
}

export interface TestOrg {
  id: string;
  publicCode: string;
  legalName: string;
}

/** 挂着 PROTECTED_EMAILS 里任一账号的组织 id —— 真身，永不删 */
async function protectedOrgIds(prisma: PrismaClient): Promise<Set<string>> {
  const key = Buffer.from(envVal("PII_BLIND_INDEX_KEY"), "hex");
  const bidx = (v: string) => createHmac("sha256", key).update(v.trim().toLowerCase()).digest("hex");
  const users = await prisma.user.findMany({
    where: { emailBidx: { in: PROTECTED_EMAILS.map(bidx) } },
    select: { id: true },
  });
  const memberships = await prisma.membership.findMany({
    where: { userId: { in: users.map((u) => u.id) } },
    select: { orgId: true },
  });
  return new Set(memberships.map((m) => m.orgId));
}

/**
 * 找出测试组织。
 * @param runId 传入时只匹配该批次（smoke 脚本自清理用），不传则匹配全部历史测试数据
 */
export async function findTestOrgs(prisma: PrismaClient, runId?: string | number): Promise<TestOrg[]> {
  const decrypt = makeDecryptor();
  const orgs = await prisma.organization.findMany({ select: { id: true, publicCode: true, legalNameEnc: true } });
  const suffix = runId === undefined ? null : String(runId);
  const protectedIds = await protectedOrgIds(prisma);

  return orgs
    .map((o) => ({ id: o.id, publicCode: o.publicCode, legalName: decrypt(o.legalNameEnc) }))
    .filter((o) => {
      if (!o.legalName) return false;
      if (protectedIds.has(o.id)) return false; // 真身与演示主体，无论叫什么都不动
      if (suffix !== null) {
        return o.legalName.endsWith(` ${suffix}`) && TEST_ORG_PATTERNS.some((p) => p.test(o.legalName));
      }
      if (TEST_ORG_PATTERNS.some((p) => p.test(o.legalName))) return true;
      if (LEGACY_TEST_ORG_NAMES.includes(o.legalName)) return true;
      // 与真数据同名但无真实成员 → smoke.ts 早期留下的影子副本
      return AMBIGUOUS_REAL_ORG_NAMES.includes(o.legalName);
    });
}

export interface PurgeReport {
  orgs: number;
  users: number;
  rows: Record<string, number>;
}

/**
 * 删除这些组织及其全部关联数据。
 * 只删「属于这些组织」的行；跨组织共享的字典表（品类/物种/国家/汇率/状态机）一律不碰。
 */
export async function purgeOrgs(prisma: PrismaClient, orgIds: string[]): Promise<PurgeReport> {
  if (orgIds.length === 0) return { orgs: 0, users: 0, rows: {} };

  const rows: Record<string, number> = {};
  const note = (table: string, count: number) => {
    if (count > 0) rows[table] = (rows[table] ?? 0) + count;
  };

  // ---- 先把从属实体的主键捞齐（删除时不能再靠 join） ----
  const memberships = await prisma.membership.findMany({ where: { orgId: { in: orgIds } }, select: { userId: true } });
  const userIds = [...new Set(memberships.map((m) => m.userId))];

  const orgFilter = { OR: [{ buyerOrgId: { in: orgIds } }, { supplierOrgId: { in: orgIds } }] };
  const orders = await prisma.tradeOrder.findMany({ where: orgFilter, select: { id: true } });
  const orderIds = orders.map((o) => o.id);

  const products = await prisma.product.findMany({ where: { supplierOrgId: { in: orgIds } }, select: { id: true } });
  const productIds = products.map((p) => p.id);
  const skus = await prisma.productSku.findMany({ where: { productId: { in: productIds } }, select: { id: true } });
  const skuIds = skus.map((s) => s.id);
  const lots = await prisma.inventoryLot.findMany({ where: { skuId: { in: skuIds } }, select: { id: true } });
  const lotIds = lots.map((l) => l.id);

  const units = await prisma.productionUnit.findMany({ where: { supplierOrgId: { in: orgIds } }, select: { id: true } });
  const unitIds = units.map((u) => u.id);
  const subunits = await prisma.productionSubunit.findMany({ where: { unitId: { in: unitIds } }, select: { id: true } });
  const subunitIds = subunits.map((s) => s.id);
  const sourceBatches = await prisma.sourceBatch.findMany({ where: { subunitId: { in: subunitIds } }, select: { id: true } });
  const sourceBatchIds = sourceBatches.map((b) => b.id);
  const procBatches = await prisma.processingBatch.findMany({ where: { supplierOrgId: { in: orgIds } }, select: { id: true } });
  const procBatchIds = procBatches.map((b) => b.id);

  const shipments = await prisma.shipment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  const shipmentIds = shipments.map((s) => s.id);
  const documents = await prisma.document.findMany({
    where: { OR: [{ ownerOrgId: { in: orgIds } }, { refId: { in: orderIds } }] },
    select: { id: true },
  });
  const documentIds = documents.map((d) => d.id);
  const permits = await prisma.citesPermit.findMany({ where: { supplierOrgId: { in: orgIds } }, select: { id: true } });
  const permitIds = permits.map((p) => p.id);
  const payments = await prisma.payment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  const paymentIds = payments.map((p) => p.id);
  const carts = await prisma.cart.findMany({ where: { buyerOrgId: { in: orgIds } }, select: { id: true } });
  const cartIds = carts.map((c) => c.id);
  const rfqs = await prisma.rfq.findMany({ where: { buyerOrgId: { in: orgIds } }, select: { id: true } });
  const rfqIds = rfqs.map((r) => r.id);
  const opportunities = await prisma.opportunity.findMany({ where: orgFilter, select: { id: true } });
  const opportunityIds = opportunities.map((o) => o.id);
  const auctions = await prisma.auction.findMany({ where: { supplierOrgId: { in: orgIds } }, select: { id: true } });
  const auctionIds = auctions.map((a) => a.id);
  const participants = await prisma.auctionParticipant.findMany({
    where: { OR: [{ auctionId: { in: auctionIds } }, { buyerOrgId: { in: orgIds } }] },
    select: { id: true },
  });
  const futures = await prisma.futuresContract.findMany({ where: { supplierOrgId: { in: orgIds } }, select: { id: true } });
  const conversationParts = await prisma.conversationParticipant.findMany({
    where: { OR: [{ orgId: { in: orgIds } }, { userId: { in: userIds } }] },
    select: { conversationId: true },
  });
  const conversationIds = [...new Set(conversationParts.map((c) => c.conversationId))];

  const inIds = (ids: string[]) => ({ in: ids });

  await prisma.$transaction(
    async (tx) => {
      // ---- 资金（叶 → 根）----
      note("refunds", (await tx.refund.deleteMany({ where: { paymentId: inIds(paymentIds) } })).count);
      note("ledger_entries", (await tx.ledgerEntry.deleteMany({ where: { OR: [{ orgId: inIds(orgIds) }, { orderId: inIds(orderIds) }] } })).count);
      note("transfers", (await tx.transfer.deleteMany({ where: { OR: [{ orderId: inIds(orderIds) }, { supplierOrgId: inIds(orgIds) }] } })).count);
      note("payment_milestones", (await tx.paymentMilestone.deleteMany({ where: { orderId: inIds(orderIds) } })).count);
      note("payments", (await tx.payment.deleteMany({ where: { orderId: inIds(orderIds) } })).count);
      note("invoices", (await tx.invoice.deleteMany({ where: { orderId: inIds(orderIds) } })).count);
      note("stripe_accounts", (await tx.stripeAccount.deleteMany({ where: { orgId: inIds(orgIds) } })).count);

      // ---- 履约 ----
      note("temperature_logs", (await tx.temperatureLog.deleteMany({ where: { shipmentId: inIds(shipmentIds) } })).count);
      note("shipment_legs", (await tx.shipmentLeg.deleteMany({ where: { shipmentId: inIds(shipmentIds) } })).count);
      note("shipments", (await tx.shipment.deleteMany({ where: { orderId: inIds(orderIds) } })).count);
      note("customs_declarations", (await tx.customsDeclaration.deleteMany({ where: { orderId: inIds(orderIds) } })).count);
      note("masked_document_copies", (await tx.maskedDocumentCopy.deleteMany({ where: { OR: [{ documentId: inIds(documentIds) }, { sentToOrgId: inIds(orgIds) }] } })).count);
      note("documents", (await tx.document.deleteMany({ where: { id: inIds(documentIds) } })).count);
      note("cites_permit_lines", (await tx.citesPermitLine.deleteMany({ where: { permitId: inIds(permitIds) } })).count);
      note("cites_permits", (await tx.citesPermit.deleteMany({ where: { id: inIds(permitIds) } })).count);
      note("disputes", (await tx.dispute.deleteMany({ where: { OR: [{ orderId: inIds(orderIds) }, { raisedByOrgId: inIds(orgIds) }] } })).count);

      // ---- 交易 ----
      note("order_items", (await tx.orderItem.deleteMany({ where: { orderId: inIds(orderIds) } })).count);
      note("trade_orders", (await tx.tradeOrder.deleteMany({ where: { id: inIds(orderIds) } })).count);
      note("trade_contracts", (await tx.tradeContract.deleteMany({ where: { OR: [{ buyerOrgId: inIds(orgIds) }, { supplierOrgId: inIds(orgIds) }] } })).count);
      note("cart_items", (await tx.cartItem.deleteMany({ where: { cartId: inIds(cartIds) } })).count);
      note("carts", (await tx.cart.deleteMany({ where: { id: inIds(cartIds) } })).count);
      note("quotes", (await tx.quote.deleteMany({ where: { OR: [{ rfqId: inIds(rfqIds) }, { supplierOrgId: inIds(orgIds) }] } })).count);
      note("rfqs", (await tx.rfq.deleteMany({ where: { id: inIds(rfqIds) } })).count);
      note("lois", (await tx.loi.deleteMany({ where: { buyerOrgId: inIds(orgIds) } })).count);
      note("auction_bids", (await tx.auctionBid.deleteMany({ where: { OR: [{ auctionId: inIds(auctionIds) }, { participantId: inIds(participants.map((p) => p.id)) }] } })).count);
      note("auction_participants", (await tx.auctionParticipant.deleteMany({ where: { id: inIds(participants.map((p) => p.id)) } })).count);
      note("auctions", (await tx.auction.deleteMany({ where: { id: inIds(auctionIds) } })).count);
      note("futures_subscriptions", (await tx.futuresSubscription.deleteMany({ where: { OR: [{ contractId: inIds(futures.map((f) => f.id)) }, { buyerOrgId: inIds(orgIds) }] } })).count);
      note("futures_contracts", (await tx.futuresContract.deleteMany({ where: { id: inIds(futures.map((f) => f.id)) } })).count);

      // ---- 库存与溯源 ----
      note("reservations", (await tx.reservation.deleteMany({ where: { lotId: inIds(lotIds) } })).count);
      note("inventory_transactions", (await tx.inventoryTransaction.deleteMany({ where: { lotId: inIds(lotIds) } })).count);
      note("inventory_lots", (await tx.inventoryLot.deleteMany({ where: { id: inIds(lotIds) } })).count);
      note("processing_steps", (await tx.processingStep.deleteMany({ where: { processingBatchId: inIds(procBatchIds) } })).count);
      note("processing_batches", (await tx.processingBatch.deleteMany({ where: { id: inIds(procBatchIds) } })).count);
      note("care_records", (await tx.careRecord.deleteMany({ where: { sourceBatchId: inIds(sourceBatchIds) } })).count);
      note("individual_assets", (await tx.individualAsset.deleteMany({ where: { sourceBatchId: inIds(sourceBatchIds) } })).count);
      note("source_batches", (await tx.sourceBatch.deleteMany({ where: { id: inIds(sourceBatchIds) } })).count);
      note("production_subunits", (await tx.productionSubunit.deleteMany({ where: { id: inIds(subunitIds) } })).count);
      note("production_units", (await tx.productionUnit.deleteMany({ where: { id: inIds(unitIds) } })).count);

      // ---- 商品 ----
      note("product_embeddings", (await tx.productEmbedding.deleteMany({ where: { skuId: inIds(skuIds) } })).count);
      note("price_tiers", (await tx.priceTier.deleteMany({ where: { skuId: inIds(skuIds) } })).count);
      note("product_media", (await tx.productMedia.deleteMany({ where: { productId: inIds(productIds) } })).count);
      note("product_skus", (await tx.productSku.deleteMany({ where: { id: inIds(skuIds) } })).count);
      note("entity_translations", (await tx.entityTranslation.deleteMany({ where: { entityId: inIds([...productIds, ...skuIds]) } })).count);
      note("products", (await tx.product.deleteMany({ where: { id: inIds(productIds) } })).count);

      // ---- 撮合与沟通 ----
      note("opportunity_activities", (await tx.opportunityActivity.deleteMany({ where: { opportunityId: inIds(opportunityIds) } })).count);
      note("opportunities", (await tx.opportunity.deleteMany({ where: { id: inIds(opportunityIds) } })).count);
      note("call_logs", (await tx.callLog.deleteMany({ where: { OR: [{ targetOrgId: inIds(orgIds) }, { brokerUserId: inIds(userIds) }] } })).count);
      note("messages", (await tx.message.deleteMany({ where: { OR: [{ conversationId: inIds(conversationIds) }, { senderUserId: inIds(userIds) }] } })).count);
      note("conversation_participants", (await tx.conversationParticipant.deleteMany({ where: { conversationId: inIds(conversationIds) } })).count);
      note("conversations", (await tx.conversation.deleteMany({ where: { id: inIds(conversationIds) } })).count);
      note("message_block_events", (await tx.messageBlockEvent.deleteMany({ where: { userId: inIds(userIds) } })).count);
      note("demand_embeddings", (await tx.demandEmbedding.deleteMany({ where: { buyerOrgId: inIds(orgIds) } })).count);
      note("demand_profiles", (await tx.demandProfile.deleteMany({ where: { buyerOrgId: inIds(orgIds) } })).count);
      note("behavior_events", (await tx.behaviorEvent.deleteMany({ where: { OR: [{ orgId: inIds(orgIds) }, { userId: inIds(userIds) }] } })).count);

      // ---- 主体与账号 ----
      note("party_certificates", (await tx.partyCertificate.deleteMany({ where: { orgId: inIds(orgIds) } })).count);
      note("addresses", (await tx.address.deleteMany({ where: { orgId: inIds(orgIds) } })).count);
      note("contacts", (await tx.contact.deleteMany({ where: { orgId: inIds(orgIds) } })).count);
      note("supplier_profiles", (await tx.supplierProfile.deleteMany({ where: { orgId: inIds(orgIds) } })).count);
      note("buyer_profiles", (await tx.buyerProfile.deleteMany({ where: { orgId: inIds(orgIds) } })).count);
      note("memberships", (await tx.membership.deleteMany({ where: { orgId: inIds(orgIds) } })).count);
      note("organizations", (await tx.organization.deleteMany({ where: { id: inIds(orgIds) } })).count);

      note("notifications", (await tx.notification.deleteMany({ where: { userId: inIds(userIds) } })).count);
      note("notification_preferences", (await tx.notificationPreference.deleteMany({ where: { userId: inIds(userIds) } })).count);
      note("data_subject_requests", (await tx.dataSubjectRequest.deleteMany({ where: { userId: inIds(userIds) } })).count);
      note("access_escalations", (await tx.accessEscalation.deleteMany({ where: { requesterId: inIds(userIds) } })).count);
      note("password_reset_tokens", (await tx.passwordResetToken.deleteMany({ where: { userId: inIds(userIds) } })).count);
      note("sessions", (await tx.session.deleteMany({ where: { userId: inIds(userIds) } })).count);
      note("oauth_accounts", (await tx.oAuthAccount.deleteMany({ where: { userId: inIds(userIds) } })).count);
      note("user_roles", (await tx.userRole.deleteMany({ where: { userId: inIds(userIds) } })).count);
      note("llm_call_logs", (await tx.llmCallLog.deleteMany({ where: { actorUserId: inIds(userIds) } })).count);
      note("audit_logs", (await tx.auditLog.deleteMany({ where: { actorId: inIds(userIds) } })).count);
      note("users", (await tx.user.deleteMany({ where: { id: inIds(userIds) } })).count);
    },
    { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );

  return { orgs: orgIds.length, users: userIds.length, rows };
}

/** smoke 脚本收尾用：只清本批次（runId）造的数据，失败时调用方应跳过以便排障 */
export async function purgeRun(prisma: PrismaClient, runId: string | number): Promise<PurgeReport> {
  const orgs = await findTestOrgs(prisma, runId);
  return purgeOrgs(prisma, orgs.map((o) => o.id));
}

/**
 * 清除没有组织归属的游离测试账号（如 smoke-compliance 里被 GDPR 匿名化的那个注销账号：
 * 邮箱盲索引已被换掉，成员关系也解除了，只能按 id 点名）。
 */
export async function purgeUserIds(prisma: PrismaClient, userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const ids = { in: userIds };
  await prisma.$transaction(async (tx) => {
    await tx.notification.deleteMany({ where: { userId: ids } });
    await tx.notificationPreference.deleteMany({ where: { userId: ids } });
    await tx.dataSubjectRequest.deleteMany({ where: { userId: ids } });
    await tx.accessEscalation.deleteMany({ where: { requesterId: ids } });
    await tx.messageBlockEvent.deleteMany({ where: { userId: ids } });
    await tx.message.deleteMany({ where: { senderUserId: ids } });
    await tx.conversationParticipant.deleteMany({ where: { userId: ids } });
    await tx.behaviorEvent.deleteMany({ where: { userId: ids } });
    await tx.passwordResetToken.deleteMany({ where: { userId: ids } });
    await tx.session.deleteMany({ where: { userId: ids } });
    await tx.oAuthAccount.deleteMany({ where: { userId: ids } });
    await tx.userRole.deleteMany({ where: { userId: ids } });
    await tx.llmCallLog.deleteMany({ where: { actorUserId: ids } });
    await tx.auditLog.deleteMany({ where: { actorId: ids } });
    await tx.membership.deleteMany({ where: { userId: ids } });
    await tx.user.deleteMany({ where: { id: ids } });
  });
  return userIds.length;
}

/**
 * smoke 脚本统一收尾。
 * 全绿才回收；有失败项则**保留现场**——排查失败时最需要的就是那批数据。
 */
export async function finishSmoke(
  prisma: PrismaClient,
  runId: string | number,
  failures: number,
  extraUserIds: string[] = [],
): Promise<void> {
  if (failures > 0) {
    console.log(`⚠ 有失败项，本次测试数据已保留以便排查；确认后可清理：npx tsx scripts/clean-test-data.ts`);
    return;
  }
  try {
    const report = await purgeRun(prisma, runId);
    const users = report.users + (await purgeUserIds(prisma, extraUserIds));
    const rowTotal = Object.values(report.rows).reduce((a, b) => a + b, 0) + extraUserIds.length;
    console.log(`🧹 已回收本次测试数据：${report.orgs} 个主体 / ${users} 个账号 / ${rowTotal} 行`);
  } catch (err) {
    // 回收失败不该把绿灯的冒烟判成红灯，但要说清楚，否则脏数据会悄悄堆积
    console.log(`⚠ 测试数据回收失败（冒烟结果不受影响）：${err instanceof Error ? err.message : String(err)}`);
  }
}
