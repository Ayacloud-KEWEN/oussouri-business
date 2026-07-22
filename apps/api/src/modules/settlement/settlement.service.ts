import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { StripePort } from "./stripe.port";
import { TradingService } from "../trading/trading.service";
import { MilestoneService } from "../trading/milestone.service";
import type { JwtPayload } from "../iam/auth.types";

/** 分期付款可继续收款的订单状态：发货前均可付后续期数（R1.5-1） */
const PAYABLE_STATES = ["PLACED", "PAID_ESCROW", "CONFIRMED", "PREPARING"];

const SYSTEM_ACTOR: JwtPayload = { sub: "00000000-0000-0000-0000-000000000000", roles: ["SYSTEM"] };

/** 资金域（M09）：Stripe 为资金事实源，LedgerEntry 为影子账（BR-09-01） */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stripe: StripePort,
    private readonly trading: TradingService,
    private readonly milestones: MilestoneService,
  ) {}

  /** Buyer 发起支付：创建 PaymentIntent（幂等：同订单未支付复用） */
  async checkout(orderCode: string, user: JwtPayload) {
    const order = await this.prisma.tradeOrder.findFirst({ where: { publicCode: orderCode, deletedAt: null } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", detail: "订单不存在" });
    if (order.buyerOrgId !== user.orgId) throw new ForbiddenException({ code: "PERM_SCOPE_VIOLATION", detail: "仅本组织订单" });

    // 分期订单（R1.5-1）：本次只收最早一期未付里程碑，否则收全额
    const nextMilestone = await this.prisma.paymentMilestone.findFirst({
      where: { orderId: order.id, status: "PENDING", deletedAt: null },
      orderBy: { seq: "asc" },
    });
    // 一次性全额只在 PLACED 可付；分期订单在发货前的各状态都可继续付后续期数
    const payableStates = nextMilestone ? PAYABLE_STATES : ["PLACED"];
    if (!payableStates.includes(order.status)) {
      throw new ConflictException({
        code: "STATE_TRANSITION_DENIED",
        detail: nextMilestone ? `订单状态 ${order.status} 不可再付款` : "订单当前不可支付",
      });
    }
    if (!nextMilestone && order.status !== "PLACED") {
      throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "订单当前不可支付" });
    }

    // 同期未完成的支付意图直接复用（幂等）
    const existing = await this.prisma.payment.findFirst({
      where: { orderId: order.id, status: "PENDING", deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.stripePaymentIntentId) {
      return {
        paymentId: existing.id,
        intentId: existing.stripePaymentIntentId,
        amount: existing.amount.toString(),
        milestone: nextMilestone ? { seq: nextMilestone.seq, label: nextMilestone.label } : null,
      };
    }

    const payAmount = nextMilestone?.amount ?? order.grandTotal;

    const amountMinor = payAmount.mul(100).toNumber();
    const intent = await this.stripe.createPaymentIntent(Math.round(amountMinor), order.currency, {
      orderCode: order.publicCode,
      orderId: order.id,
      ...(nextMilestone ? { milestoneSeq: String(nextMilestone.seq), milestoneLabel: nextMilestone.label } : {}),
    });
    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        refType: "ORDER",
        refId: order.id,
        method: "STRIPE_CARD",
        stripePaymentIntentId: intent.intentId,
        amount: payAmount,
        currency: order.currency,
        createdBy: user.sub,
      },
    });
    return {
      paymentId: payment.id,
      intentId: intent.intentId,
      clientSecret: intent.clientSecret,
      amount: payAmount.toString(),
      milestone: nextMilestone ? { seq: nextMilestone.seq, label: nextMilestone.label } : null,
    };
  }

  /** Stripe Webhook：幂等处理支付成功 → 入托管账 + 订单状态迁移 */
  async handleWebhook(rawBody: Buffer | string, signature: string) {
    const event = this.stripe.verifyWebhook(rawBody, signature);
    if (!event) throw new ForbiddenException({ code: "PERM_DENIED", detail: "Webhook 签名无效" });

    if (event.type === "payment_intent.succeeded") {
      const intent = (event.data as { object: { id: string } }).object;
      await this.onPaymentSucceeded(intent.id);
    }
    return { received: true };
  }

  private async onPaymentSucceeded(intentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { stripePaymentIntentId: intentId } });
    if (!payment || payment.status === "SUCCEEDED") return; // 幂等
    const order = await this.prisma.tradeOrder.findUniqueOrThrow({ where: { id: payment.orderId! } });

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "SUCCEEDED", paidAt: new Date(), version: { increment: 1 } },
      });
      // 账本：买家在途 → 托管冻结
      const journalId = randomUUID();
      await tx.ledgerEntry.createMany({
        data: [
          { journalId, account: "BUYER_FUNDS_IN_TRANSIT", orgId: order.buyerOrgId, orderId: order.id, direction: "DEBIT", amount: payment.amount, currency: payment.currency },
          { journalId, account: "ESCROW_HELD", orderId: order.id, direction: "CREDIT", amount: payment.amount, currency: payment.currency },
        ],
      });
      // 分期订单：把本次金额归集到最早未付里程碑（R1.5-1）
      await this.milestones.settleByPayment(tx, order.id, payment.id, payment.amount);
      await this.audit.logInTx(tx, {
        action: "PAYMENT_SUCCEEDED",
        targetType: "TradeOrder",
        targetId: order.id,
        diff: { intentId, amount: payment.amount.toString() },
      });
    });
    // 状态机：PLACED → PAID_ESCROW（SYSTEM 角色）；分期订单首期到账即可推进，尾款由发货守卫把关
    if (order.status === "PLACED") {
      await this.trading.transition(order.publicCode, "PAID_ESCROW", SYSTEM_ACTOR, { asSystem: true, reason: `stripe:${intentId}` });
    }
  }

  /** 签收完成后放款（OrderDelivered 事件消费者 → 争议期满后 COMPLETED + 分账） */
  @OnEvent("OrderDelivered")
  async onOrderDelivered(event: { payload: { orderId: string; code: string } }): Promise<void> {
    // P1 简化：无争议即放款（争议期 48h 的定时驱动版本在 worker 批次补充；此处按事件直接结算演示闭环）
    try {
      await this.releaseEscrow(event.payload.code);
    } catch (err) {
      this.logger.error(`放款失败 ${event.payload.code}`, err instanceof Error ? err.stack : String(err));
    }
  }

  async releaseEscrow(orderCode: string) {
    const order = await this.prisma.tradeOrder.findFirstOrThrow({ where: { publicCode: orderCode, deletedAt: null } });
    if (order.status !== "DELIVERED") {
      throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "仅已签收订单可放款" });
    }
    const openDispute = await this.prisma.dispute.findFirst({
      where: { orderId: order.id, status: { in: ["OPEN", "INVESTIGATING"] }, deletedAt: null },
    });
    if (openDispute) throw new ConflictException({ code: "STATE_TRANSITION_DENIED", detail: "存在进行中争议，资金冻结" });

    const supplierAmount = order.grandTotal.minus(order.commissionAmount);
    const stripeAccount = await this.prisma.stripeAccount.findUnique({ where: { orgId: order.supplierOrgId } });
    // 真实网关下必须有已完成入驻的 Connect 账户，否则放款会打到占位账户（R1-2）
    if (!stripeAccount?.stripeAccountId && this.stripe.publishableKey) {
      throw new ConflictException({
        code: "SUPPLIER_PAYOUT_NOT_READY",
        detail: "供应商尚未完成 Stripe Connect 入驻，无法放款",
      });
    }
    const destination = stripeAccount?.stripeAccountId ?? "acct_fake_supplier";
    const transferResult = await this.stripe.createTransfer(
      Math.round(supplierAmount.mul(100).toNumber()),
      order.currency,
      destination,
      { orderCode: order.publicCode },
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.transfer.create({
        data: {
          orderId: order.id,
          stripeTransferId: transferResult.transferId,
          supplierOrgId: order.supplierOrgId,
          amount: supplierAmount,
          currency: order.currency,
          status: "SENT",
          triggeredBy: "AUTO_RELEASE",
        },
      });
      // 账本：托管 → 供应商应收 + 平台佣金
      const journalId = randomUUID();
      await tx.ledgerEntry.createMany({
        data: [
          { journalId, account: "ESCROW_HELD", orderId: order.id, direction: "DEBIT", amount: order.grandTotal, currency: order.currency },
          { journalId, account: "SUPPLIER_PAYABLE", orgId: order.supplierOrgId, orderId: order.id, direction: "CREDIT", amount: supplierAmount, currency: order.currency },
          { journalId, account: "PLATFORM_COMMISSION", orderId: order.id, direction: "CREDIT", amount: order.commissionAmount, currency: order.currency },
        ],
      });
      await this.audit.logInTx(tx, {
        action: "ESCROW_RELEASED",
        targetType: "TradeOrder",
        targetId: order.id,
        diff: { transferId: transferResult.transferId, supplierAmount: supplierAmount.toString(), commission: order.commissionAmount.toString() },
      });
    });
    await this.trading.transition(order.publicCode, "COMPLETED", SYSTEM_ACTOR, { asSystem: true, reason: "escrow released" });
    return { orderCode, transferId: transferResult.transferId, supplierAmount: supplierAmount.toString() };
  }

  // ---------- Stripe Connect 入驻（R1-2） ----------

  /** 前端 Elements 初始化用；无真实密钥时返回 null，前端回退开发态模拟支付 */
  publicConfig() {
    return { publishableKey: this.stripe.publishableKey, live: Boolean(this.stripe.publishableKey) };
  }

  /**
   * 生成入驻链接：首次调用创建 Connect 账户并落库，随后每次生成一次性 onboarding 链接。
   * 供应商完成 KYC 后由 /connect/status 回写状态（Stripe 亦会发 account.updated webhook）。
   */
  async connectOnboarding(user: JwtPayload, returnUrl: string, refreshUrl: string) {
    if (!user.orgId) throw new ForbiddenException({ code: "PERM_DENIED", detail: "需要供应商身份" });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
    let account = await this.prisma.stripeAccount.findUnique({ where: { orgId: org.id } });

    if (!account) {
      const created = await this.stripe.createConnectAccount({ country: org.countryIso2, orgCode: org.publicCode });
      account = await this.prisma.stripeAccount.create({
        data: {
          orgId: org.id,
          stripeAccountId: created.accountId,
          onboardingStatus: "PENDING",
          defaultCurrency: org.countryIso2 === "CN" ? "eur" : undefined,
        },
      });
      await this.audit.log({
        actorId: user.sub, actorRole: user.roles.join(","), action: "CONNECT_ACCOUNT_CREATED",
        targetType: "StripeAccount", targetId: account.id, diff: { stripeAccountId: created.accountId },
      });
    }

    const link = await this.stripe.createAccountLink(account.stripeAccountId, refreshUrl, returnUrl);
    return { url: link.url, expiresAt: link.expiresAt, stripeAccountId: account.stripeAccountId };
  }

  /** 查询并回写入驻状态（供应商工作台轮询/返回时调用） */
  async connectStatus(user: JwtPayload) {
    if (!user.orgId) throw new ForbiddenException({ code: "PERM_DENIED", detail: "需要供应商身份" });
    const account = await this.prisma.stripeAccount.findUnique({ where: { orgId: user.orgId } });
    if (!account) return { onboarded: false, status: "NOT_STARTED" as const, requirementsDue: [] as string[] };

    const status = await this.stripe.getAccountStatus(account.stripeAccountId);
    const next = status.payoutsEnabled ? "COMPLETED" : status.detailsSubmitted ? "PENDING_VERIFICATION" : "PENDING";
    if (next !== account.onboardingStatus) {
      await this.prisma.stripeAccount.update({
        where: { id: account.id },
        data: { onboardingStatus: next, version: { increment: 1 } },
      });
    }
    return {
      onboarded: status.payoutsEnabled,
      status: next,
      requirementsDue: status.requirementsDue,
      stripeAccountId: account.stripeAccountId,
    };
  }

  /** 账本查询（财务） */
  async ledger(account?: string, page = 1, pageSize = 50) {
    const where: Prisma.LedgerEntryWhereInput = account ? { account: account as never } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    return { data: rows, meta: { page, pageSize, total } };
  }
}
