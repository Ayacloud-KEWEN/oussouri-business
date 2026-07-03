import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Outbox 调度器：轮询未发布事件 → 进程内 EventEmitter 分发 → 标记已发布。
 * P2 起可替换为 BullMQ/Kafka 发布器，消费者侧幂等（事件 ID 去重）。
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

  @Interval(2000)
  async dispatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      for (const event of events) {
        await this.emitter.emitAsync(event.eventType, { id: event.id, aggregate: event.aggregate, payload: event.payload });
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
      }
    } catch (err) {
      this.logger.error("Outbox 分发失败", err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }
}
