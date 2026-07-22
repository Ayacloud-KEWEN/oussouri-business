import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { CertStatus } from "@prisma/client";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CryptoService } from "../../kernel/crypto/crypto.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { CommunicationService } from "../communication/communication.service";
import { MailPort } from "../communication/mail.port";

/** 提醒档位（天）：命中最小的仍 ≥ 剩余天数的档位，保证每档只提醒一次 */
export const REMINDER_BUCKETS = [60, 30, 7] as const;
/** 扫描窗口：最大档位即窗口上界 */
const SCAN_WINDOW_DAYS: number = REMINDER_BUCKETS[0];

export type CertKind = "PARTY_CERT" | "CITES_PERMIT" | "DOCUMENT";
export type ExpiryBucket = "60" | "30" | "7" | "EXPIRED";

export interface ExpiringCert {
  kind: CertKind;
  id: string;
  /** 证件号（PartyCertificate.certNo / CitesPermit.permitNo / Document.docNo） */
  certNo: string;
  certType: string;
  orgId: string | null;
  expiryDate: Date;
  daysToExpiry: number;
  bucket: ExpiryBucket;
  status: string;
}

interface MailCopy {
  subject: string;
  body: (c: ExpiringCert) => string;
}

/** 到期提醒邮件三语文案（用户 locale 决定，缺省英文） */
const EXPIRY_MAIL_COPY: Record<string, MailCopy> = {
  "zh-CN": {
    subject: "【Oussouri】证照到期提醒",
    body: (c) =>
      c.daysToExpiry < 0
        ? `您的 ${c.certType}（编号 ${c.certNo}）已于 ${c.expiryDate.toISOString().slice(0, 10)} 过期，相关业务可能受限，请尽快更新。`
        : `您的 ${c.certType}（编号 ${c.certNo}）将于 ${c.expiryDate.toISOString().slice(0, 10)} 到期，剩余 ${c.daysToExpiry} 天，请及时办理续期。`,
  },
  en: {
    subject: "[Oussouri] Certificate expiry reminder",
    body: (c) =>
      c.daysToExpiry < 0
        ? `Your ${c.certType} (no. ${c.certNo}) expired on ${c.expiryDate.toISOString().slice(0, 10)}. Related operations may be blocked until it is renewed.`
        : `Your ${c.certType} (no. ${c.certNo}) expires on ${c.expiryDate.toISOString().slice(0, 10)}, in ${c.daysToExpiry} days. Please start the renewal.`,
  },
  fr: {
    subject: "[Oussouri] Rappel d'expiration de certificat",
    body: (c) =>
      c.daysToExpiry < 0
        ? `Votre ${c.certType} (n° ${c.certNo}) a expiré le ${c.expiryDate.toISOString().slice(0, 10)}. Les opérations concernées peuvent être bloquées.`
        : `Votre ${c.certType} (n° ${c.certNo}) expire le ${c.expiryDate.toISOString().slice(0, 10)}, dans ${c.daysToExpiry} jours. Merci d'engager le renouvellement.`,
  },
};

/**
 * 证照到期扫描（R1-5，M12 合规运营）。
 * 覆盖三类到期物：组织资质 PartyCertificate、CITES 许可证 CitesPermit、订单单证 Document。
 * 每日一次：分档提醒持证方 + 内部合规角色汇总；已过期的自动置 EXPIRED（不可逆状态，故只从 VALID/PENDING 迁入）。
 * 幂等：同一 (证件, 档位) 对同一用户只发一次，靠 Notification.payload.dedupeKey 去重，重跑安全。
 */
@Injectable()
export class CertExpiryService {
  private readonly logger = new Logger(CertExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly comm: CommunicationService,
    private readonly mail: MailPort,
  ) {}

  @Cron("0 3 * * *") // 每日 03:00
  async scheduledRun(): Promise<void> {
    try {
      const result = await this.runScan();
      if (result.notified > 0 || result.expired > 0) {
        this.logger.log(`证照扫描：${result.scanned} 条待到期，置过期 ${result.expired} 条，发出提醒 ${result.notified} 条`);
      }
    } catch (err) {
      this.logger.error("证照到期扫描失败", err instanceof Error ? err.stack : String(err));
    }
  }

  /** 落档：剩余天数 → 提醒档位；超出最大档位返回 null（本轮不提醒） */
  static bucketOf(daysToExpiry: number): ExpiryBucket | null {
    if (daysToExpiry < 0) return "EXPIRED";
    const hit = [...REMINDER_BUCKETS].reverse().find((b) => daysToExpiry <= b);
    return hit ? (String(hit) as ExpiryBucket) : null;
  }

  private static days(expiry: Date, now: Date): number {
    // 按自然日取整：今天到期算 0 天，昨天到期算 -1 天
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const startOfExpiry = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
    return Math.round((startOfExpiry - startOfToday) / 86_400_000);
  }

  /**
   * 列出窗口内（默认 60 天）到期与已过期的证照。
   * 已过期的一并返回，便于后台看板一屏掌握；不做 org 过滤的调用方须自行限定内部角色。
   */
  async listExpiring(withinDays = SCAN_WINDOW_DAYS, orgId?: string): Promise<ExpiringCert[]> {
    const now = new Date();
    const until = new Date(now.getTime() + withinDays * 86_400_000);
    const active = { in: [CertStatus.VALID, CertStatus.PENDING] };

    const [partyCerts, permits, documents] = await Promise.all([
      this.prisma.partyCertificate.findMany({
        where: { deletedAt: null, status: active, expiryDate: { not: null, lte: until }, ...(orgId ? { orgId } : {}) },
      }),
      this.prisma.citesPermit.findMany({
        where: { deletedAt: null, status: active, expiryDate: { lte: until }, ...(orgId ? { supplierOrgId: orgId } : {}) },
      }),
      this.prisma.document.findMany({
        where: { deletedAt: null, status: active, expiryDate: { not: null, lte: until }, ...(orgId ? { ownerOrgId: orgId } : {}) },
      }),
    ]);

    const items: ExpiringCert[] = [];
    const push = (item: Omit<ExpiringCert, "daysToExpiry" | "bucket">) => {
      const daysToExpiry = CertExpiryService.days(item.expiryDate, now);
      const bucket = CertExpiryService.bucketOf(daysToExpiry);
      if (!bucket) return; // 超出窗口（理论上被 where 挡住，边界日期兜底）
      items.push({ ...item, daysToExpiry, bucket });
    };

    for (const c of partyCerts) {
      push({ kind: "PARTY_CERT", id: c.id, certNo: c.certNo, certType: c.certType, orgId: c.orgId, expiryDate: c.expiryDate!, status: c.status });
    }
    for (const p of permits) {
      push({ kind: "CITES_PERMIT", id: p.id, certNo: p.permitNo, certType: "CITES", orgId: p.supplierOrgId, expiryDate: p.expiryDate, status: p.status });
    }
    for (const d of documents) {
      push({ kind: "DOCUMENT", id: d.id, certNo: d.docNo ?? d.id.slice(0, 8), certType: d.docType, orgId: d.ownerOrgId, expiryDate: d.expiryDate!, status: d.status });
    }

    return items.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  }

  /** 全量扫描：置过期 + 分档提醒 + 内部汇总。可由 cron 或管理员手动触发。 */
  async runScan(actorId?: string): Promise<{ scanned: number; expired: number; notified: number }> {
    const items = await this.listExpiring();
    const expired = await this.markExpired(items, actorId);
    let notified = 0;
    for (const item of items) {
      notified += await this.notifyHolders(item);
    }
    notified += await this.notifyInternal(items);
    return { scanned: items.length, expired, notified };
  }

  /** 已过期的证照置 EXPIRED（BR：过期证件不得继续用于新业务） */
  private async markExpired(items: ExpiringCert[], actorId?: string): Promise<number> {
    const overdue = items.filter((i) => i.daysToExpiry < 0 && i.status !== "EXPIRED");
    for (const item of overdue) {
      const data = { status: "EXPIRED" as const, version: { increment: 1 } };
      if (item.kind === "PARTY_CERT") await this.prisma.partyCertificate.update({ where: { id: item.id }, data });
      else if (item.kind === "CITES_PERMIT") await this.prisma.citesPermit.update({ where: { id: item.id }, data });
      else await this.prisma.document.update({ where: { id: item.id }, data });
      item.status = "EXPIRED";
      await this.audit.log({
        actorId,
        actorRole: actorId ? undefined : "SYSTEM",
        action: "CERT_EXPIRED",
        targetType: item.kind,
        targetId: item.id,
        diff: { certNo: item.certNo, certType: item.certType, expiryDate: item.expiryDate.toISOString() },
      });
    }
    return overdue.length;
  }

  /** 通知持证组织成员（站内信 + 邮件），同档只发一次 */
  private async notifyHolders(item: ExpiringCert): Promise<number> {
    if (!item.orgId) return 0;
    const memberships = await this.prisma.membership.findMany({ where: { orgId: item.orgId, deletedAt: null } });
    const dedupeKey = `${item.kind}:${item.id}:${item.bucket}`;
    let sent = 0;
    for (const m of memberships) {
      if (await this.alreadyNotified(m.userId, dedupeKey)) continue;
      await this.comm.notifyUser(m.userId, "CERT_EXPIRING", {
        dedupeKey,
        certType: item.certType,
        certNo: item.certNo,
        daysToExpiry: item.daysToExpiry,
        expiryDate: item.expiryDate.toISOString().slice(0, 10),
      });
      await this.sendMail(m.userId, item);
      sent += 1;
    }
    return sent;
  }

  /** 内部合规角色收到当日汇总（一天一条，不逐证轰炸） */
  private async notifyInternal(items: ExpiringCert[]): Promise<number> {
    const urgent = items.filter((i) => i.bucket === "EXPIRED" || i.bucket === "7");
    if (urgent.length === 0) return 0;
    const dedupeKey = `DIGEST:${new Date().toISOString().slice(0, 10)}`;
    const staff = await this.prisma.userRole.findMany({
      where: { deletedAt: null, role: { code: { in: ["QUALITY_INSPECTOR", "ADMIN", "SUPER_ADMIN"] } } },
      select: { userId: true },
    });
    let sent = 0;
    for (const userId of new Set(staff.map((s) => s.userId))) {
      if (await this.alreadyNotified(userId, dedupeKey)) continue;
      await this.comm.notifyUser(userId, "CERT_EXPIRY_DIGEST", {
        dedupeKey,
        expiredCount: urgent.filter((i) => i.bucket === "EXPIRED").length,
        urgentCount: urgent.filter((i) => i.bucket === "7").length,
      });
      sent += 1;
    }
    return sent;
  }

  private async alreadyNotified(userId: string, dedupeKey: string): Promise<boolean> {
    const existing = await this.prisma.notification.findFirst({
      where: { userId, payload: { path: ["dedupeKey"], equals: dedupeKey } },
      select: { id: true },
    });
    return existing !== null;
  }

  /** 邮件失败不阻断扫描：站内信已经发出，邮件仅为增强通道 */
  private async sendMail(userId: string, item: ExpiringCert): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null, status: "ACTIVE" } });
    if (!user) return;
    const copy = EXPIRY_MAIL_COPY[user.locale] ?? EXPIRY_MAIL_COPY.en!;
    try {
      await this.mail.send({ to: this.crypto.decrypt(user.emailEnc), subject: copy.subject, text: copy.body(item) });
    } catch (err) {
      this.logger.warn(`到期提醒邮件发送失败（user=${userId}）：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
