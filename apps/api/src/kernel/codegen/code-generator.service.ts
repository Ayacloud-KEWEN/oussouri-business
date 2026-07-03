import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { randomInt } from "node:crypto";

/**
 * 编码引擎（GBR-2）：行锁递增 + 随机跳步防遍历。
 * pattern 占位符: {prefix} {seq:N} {date:YYYYMMDD}
 */
@Injectable()
export class CodeGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  async next(entityType: string, tx?: Prisma.TransactionClient): Promise<string> {
    const run = async (client: Prisma.TransactionClient): Promise<string> => {
      const rows = await client.$queryRaw<
        { id: string; prefix: string; pattern: string; seqLength: number; jumpMax: number; currentSeq: bigint }[]
      >`SELECT id, prefix, pattern, "seqLength", "jumpMax", "currentSeq"
        FROM core.code_rules WHERE "entityType" = ${entityType} AND "deletedAt" IS NULL
        FOR UPDATE`;
      const rule = rows[0];
      if (!rule) throw new NotFoundException(`CodeRule missing: ${entityType}`);
      const jump = BigInt(randomInt(1, Math.max(2, rule.jumpMax + 1)));
      const nextSeq = rule.currentSeq + jump;
      await client.$executeRaw`UPDATE core.code_rules SET "currentSeq" = ${nextSeq}, "updatedAt" = now() WHERE id = ${rule.id}::uuid`;
      return this.render(rule.pattern, rule.prefix, rule.seqLength, nextSeq);
    };
    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  private render(pattern: string, prefix: string, seqLength: number, seq: bigint): string {
    const now = new Date();
    const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
    return pattern
      .replace("{prefix}", prefix)
      .replace(/\{seq:(\d+)\}/, (_, n: string) => seq.toString().padStart(Math.max(Number(n), seqLength), "0"))
      .replace("{date:YYYYMMDD}", date);
  }
}
