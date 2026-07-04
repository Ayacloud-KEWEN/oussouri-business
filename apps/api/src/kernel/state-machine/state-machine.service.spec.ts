import { ConflictException } from "@nestjs/common";
import { StateMachineService } from "./state-machine.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { OutboxService } from "../outbox/outbox.service";

function makeService(transitions: { fromState: string; toState: string; allowedRoles: string[]; emitsEvent: string | null }[]) {
  const prisma = {
    stateTransition: {
      findFirst: jest.fn(async ({ where }: { where: { fromState: string; toState: string } }) =>
        transitions.find((t) => t.fromState === where.fromState && t.toState === where.toState) ?? null),
    },
  } as unknown as PrismaService;
  return new StateMachineService(prisma, {} as AuditService, {} as OutboxService);
}

describe("StateMachineService（GBR-6 状态机纪律）", () => {
  const service = makeService([
    { fromState: "PLACED", toState: "PAID_ESCROW", allowedRoles: ["SYSTEM"], emitsEvent: "OrderPaid" },
    { fromState: "PLACED", toState: "CANCELLED", allowedRoles: ["BUYER", "ADMIN"], emitsEvent: null },
    { fromState: "DRAFT", toState: "PLACED", allowedRoles: ["*"], emitsEvent: "OrderPlaced" },
  ]);

  it("合法迁移 + 角色匹配 → 放行并返回事件名", async () => {
    const result = await service.assertAllowed("ORDER", "PLACED", "PAID_ESCROW", ["SYSTEM"]);
    expect(result.emitsEvent).toBe("OrderPaid");
  });

  it("未定义的迁移 → 拒绝（禁止跳状态）", async () => {
    await expect(service.assertAllowed("ORDER", "PLACED", "COMPLETED", ["ADMIN"])).rejects.toThrow(ConflictException);
  });

  it("角色不在白名单 → 拒绝（买家不能自己标记已支付）", async () => {
    await expect(service.assertAllowed("ORDER", "PLACED", "PAID_ESCROW", ["BUYER"])).rejects.toThrow(ConflictException);
  });

  it("通配符角色放行任何人", async () => {
    const result = await service.assertAllowed("ORDER", "DRAFT", "PLACED", ["GUEST"]);
    expect(result.emitsEvent).toBe("OrderPlaced");
  });
});
