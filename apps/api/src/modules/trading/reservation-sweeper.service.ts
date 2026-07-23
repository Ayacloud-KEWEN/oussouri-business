import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { TradingService } from "./trading.service";
import type { JwtPayload } from "../iam/auth.types";

const SYSTEM_ACTOR: JwtPayload = { sub: "00000000-0000-0000-0000-000000000000", roles: ["SYSTEM"] } as JwtPayload;

/**
 * 已发起支付但未收到 webhook 的宽限期。
 * 买家点了结账、Stripe intent 已建但回调还没到时，订单不能被扫掉 —— 否则钱付了单没了。
 * Stripe 的 payment intent 本身约 24h 后失效，故超过这个窗口的 PENDING 支付视为已放弃。
 */
const PENDING_PAYMENT_GRACE_HOURS = 24;

/**
 * 过期预留回收（库存底线）。
 *
 * 下单即按 24h TTL 锁货（直采/RFQ/居间意向单三条路径都设了 `Reservation.expiresAt`），
 * 但在此之前**没有任何东西执行这个 TTL** —— 买家既不付款也不取消，那批货就永久锁死：
 * `qtyOnHand` 还在，`qtyReserved` 不降，可售量被吃掉，其他人买不到。
 * `Reservation` 上那个 `@@index([expiresAt, status])` 本就是为这轮扫描建的。
 *
 * 两条处理路径：
 *   1. 订单仍在 PLACED（未付款）→ 走状态机转 CANCELLED，由既有副作用释放预留。
 *      不直接释放预留，是因为那会留下一个「状态还在 PLACED、货却没了」的订单，
 *      买家事后付款就会拿到一个无法履约的单子。
 *   2. 订单已不在 PLACED，预留却还挂着 HELD → 数据漂移，直接释放（正常流程不该出现，记 warn）。
 */
@Injectable()
export class ReservationSweeperService {
  private readonly logger = new Logger(ReservationSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly trading: TradingService,
  ) {}

  @Cron("*/10 * * * *") // 每 10 分钟
  async scheduledRun(): Promise<void> {
    try {
      const result = await this.sweep();
      if (result.ordersCancelled > 0 || result.orphansReleased > 0) {
        this.logger.log(
          `过期预留回收：取消超时订单 ${result.ordersCancelled} 笔，释放孤儿预留 ${result.orphansReleased} 条` +
            (result.skippedPendingPayment > 0 ? `，${result.skippedPendingPayment} 笔因支付在途跳过` : ""),
        );
      }
    } catch (err) {
      this.logger.error("过期预留回收失败", err instanceof Error ? err.stack : String(err));
    }
  }

  /** 可由 cron 或管理员手动触发；返回处理明细便于排障与冒烟断言 */
  async sweep(actorId?: string): Promise<{
    ordersCancelled: number;
    orphansReleased: number;
    skippedPendingPayment: number;
    cancelledOrderCodes: string[];
  }> {
    const now = new Date();
    const expired = await this.prisma.reservation.findMany({
      where: { status: "HELD", deletedAt: null, expiresAt: { not: null, lt: now }, refType: "ORDER" },
      select: { id: true, refId: true },
    });
    if (expired.length === 0) {
      return { ordersCancelled: 0, orphansReleased: 0, skippedPendingPayment: 0, cancelledOrderCodes: [] };
    }

    const orderIds = [...new Set(expired.map((r) => r.refId))];
    const orders = await this.prisma.tradeOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, publicCode: true, status: true },
    });
    const orderById = new Map(orders.map((o) => [o.id, o]));

    // 支付在途保护：有近期 PENDING 支付的订单一律不动
    const graceCutoff = new Date(now.getTime() - PENDING_PAYMENT_GRACE_HOURS * 3_600_000);
    const inFlight = await this.prisma.payment.findMany({
      where: { orderId: { in: orderIds }, status: "PENDING", deletedAt: null, createdAt: { gte: graceCutoff } },
      select: { orderId: true },
    });
    const protectedOrderIds = new Set(inFlight.map((p) => p.orderId!));

    let ordersCancelled = 0;
    let orphansReleased = 0;
    const cancelledOrderCodes: string[] = [];

    for (const orderId of orderIds) {
      const order = orderById.get(orderId);
      if (!order) {
        // 订单记录不存在（历史清理残留）：预留无归属，直接释放
        orphansReleased += await this.releaseOrphan(orderId, actorId);
        continue;
      }
      if (protectedOrderIds.has(orderId)) continue;

      if (order.status === "PLACED") {
        try {
          await this.trading.transition(order.publicCode, "CANCELLED", SYSTEM_ACTOR, {
            asSystem: true,
            reason: `锁货超时自动取消（预留 TTL 到期）`,
          });
          ordersCancelled += 1;
          cancelledOrderCodes.push(order.publicCode);
        } catch (err) {
          // 单笔失败不该拖垮整轮扫描（例如并发下已被人工取消）
          this.logger.warn(`订单 ${order.publicCode} 超时取消失败：${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // 订单已推进或已终结，预留却没释放 —— 正常流程不该出现
        const released = await this.releaseOrphan(orderId, actorId);
        if (released > 0) {
          orphansReleased += released;
          this.logger.warn(`订单 ${order.publicCode}（${order.status}）存在未释放的过期预留 ${released} 条，已回收`);
        }
      }
    }

    const skippedPendingPayment = orderIds.filter((id) => protectedOrderIds.has(id)).length;
    return { ordersCancelled, orphansReleased, skippedPendingPayment, cancelledOrderCodes };
  }

  private async releaseOrphan(orderId: string, actorId?: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.reservation.count({ where: { refType: "ORDER", refId: orderId, status: "HELD", deletedAt: null } });
      if (before === 0) return 0;
      await this.inventory.releaseInTx(tx, "ORDER", orderId, actorId ?? SYSTEM_ACTOR.sub);
      return before;
    });
  }
}
