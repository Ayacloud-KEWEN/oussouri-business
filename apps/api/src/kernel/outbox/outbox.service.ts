import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** Outbox 写入：与业务同事务插入事件，保证不丢（架构 A3） */
@Injectable()
export class OutboxService {
  async emitInTx(
    tx: Prisma.TransactionClient,
    aggregate: string,
    eventType: string,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.outboxEvent.create({ data: { aggregate, eventType, payload } });
  }
}
