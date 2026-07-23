import { Prisma } from "@prisma/client";
import { InventoryService } from "./inventory.service";

/**
 * releaseInTx 的健壮性回归。
 *
 * 真实故障（2026-07-23）：库里存在指向已删除批次的孤儿预留，`releaseInTx` 当时用 `update`，
 * 撞上第一条就抛 P2025 中断整个事务 —— 超时回收任务因此整轮失败，其他订单的库存一起放不出来。
 * 批次不存在本就不占库存，跳过即可，但预留必须照常标记 RELEASED，否则会永远卡在 HELD 被反复扫到。
 */
describe("InventoryService.releaseInTx", () => {
  const service = new InventoryService({} as never);

  /** 最小 tx 替身：只实现被调用到的三张表 */
  function makeTx(opts: { lotExists: boolean }) {
    const calls = { lotUpdates: 0, reservationUpdates: [] as string[], transactions: 0 };
    const tx = {
      reservation: {
        findMany: async () => [
          { id: "res-1", lotId: "lot-gone", qty: new Prisma.Decimal(30) },
          { id: "res-2", lotId: "lot-gone", qty: new Prisma.Decimal(10) },
        ],
        update: async ({ where, data }: any) => {
          calls.reservationUpdates.push(`${where.id}:${data.status}`);
          return {};
        },
      },
      inventoryLot: {
        updateMany: async () => {
          calls.lotUpdates += 1;
          return { count: opts.lotExists ? 1 : 0 };
        },
      },
      inventoryTransaction: {
        create: async () => {
          calls.transactions += 1;
          return {};
        },
      },
    };
    return { tx, calls };
  }

  it("批次已不存在时不抛错，预留仍标记 RELEASED", async () => {
    const { tx, calls } = makeTx({ lotExists: false });
    await expect(service.releaseInTx(tx as never, "ORDER", "order-1", "actor")).resolves.toBeUndefined();
    expect(calls.reservationUpdates).toEqual(["res-1:RELEASED", "res-2:RELEASED"]);
  });

  it("批次存在时正常扣减预留量", async () => {
    const { tx, calls } = makeTx({ lotExists: true });
    await service.releaseInTx(tx as never, "ORDER", "order-1", "actor");
    expect(calls.lotUpdates).toBe(2);
    expect(calls.reservationUpdates).toEqual(["res-1:RELEASED", "res-2:RELEASED"]);
    expect(calls.transactions).toBe(2);
  });

  it("一条坏数据不阻断同批其余预留的释放", async () => {
    // 两条预留共用一个已消失的批次；若实现是 update，第一条就会中断，第二条永远卡在 HELD
    const { tx, calls } = makeTx({ lotExists: false });
    await service.releaseInTx(tx as never, "ORDER", "order-1", "actor");
    expect(calls.reservationUpdates).toHaveLength(2);
  });
});
