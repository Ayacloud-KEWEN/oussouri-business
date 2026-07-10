import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CryptoService } from "../../kernel/crypto/crypto.service";
import { CodeGeneratorService } from "../../kernel/codegen/code-generator.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { OutboxService } from "../../kernel/outbox/outbox.service";
import { MailPort } from "../communication/mail.port";
import type { JwtPayload } from "./auth.types";
import type { BuyerType, PartyType } from "@prisma/client";

const RESET_TOKEN_TTL_MINUTES = 30;

/** 重置邮件三语文案（正式模板渲染待 R1-4 邮件通道） */
const RESET_MAIL_COPY: Record<string, { subject: string; body: (link: string) => string }> = {
  "zh-CN": {
    subject: "Oussouri Caviar HUB — 重置密码",
    body: (link) => `我们收到了你的密码重置请求。请在 ${RESET_TOKEN_TTL_MINUTES} 分钟内打开以下链接设置新密码：\n\n${link}\n\n如果不是你本人操作，请忽略本邮件。`,
  },
  en: {
    subject: "Oussouri Caviar HUB — Reset your password",
    body: (link) => `We received a request to reset your password. Open the link below within ${RESET_TOKEN_TTL_MINUTES} minutes to set a new password:\n\n${link}\n\nIf you did not request this, please ignore this email.`,
  },
  fr: {
    subject: "Oussouri Caviar HUB — Réinitialisation du mot de passe",
    body: (link) => `Nous avons reçu une demande de réinitialisation de votre mot de passe. Ouvrez le lien ci-dessous dans les ${RESET_TOKEN_TTL_MINUTES} minutes pour définir un nouveau mot de passe :\n\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
  },
};

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  locale?: string;
  partyType: "SUPPLIER" | "BUYER";
  companyName: string;
  countryIso2: string;
  buyerType?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  readonly refreshTtlDays: number;
  private readonly webUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly codegen: CodeGeneratorService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly jwt: JwtService,
    private readonly mail: MailPort,
    config: ConfigService,
  ) {
    this.refreshTtlDays = Number(config.get("REFRESH_TOKEN_TTL_DAYS") ?? 30);
    this.webUrl = config.get<string>("WEB_URL") ?? "http://localhost:3000";
  }

  async register(input: RegisterInput, ip?: string): Promise<{ userId: string; orgCode: string }> {
    const emailBidx = this.crypto.blindIndex(input.email);
    const existing = await this.prisma.user.findFirst({ where: { emailBidx, deletedAt: null } });
    if (existing) throw new ConflictException({ code: "VALIDATION_FAILED", detail: "邮箱已注册" });
    if (input.partyType === "BUYER" && !input.buyerType) {
      throw new BadRequestException({ code: "VALIDATION_FAILED", detail: "采购商需提供 buyerType" });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const orgCode = await this.codegen.next(input.partyType, tx);
      const org = await tx.organization.create({
        data: {
          publicCode: orgCode,
          partyType: input.partyType as PartyType,
          legalNameEnc: this.crypto.encrypt(input.companyName),
          legalNameBidx: this.crypto.blindIndex(input.companyName),
          countryIso2: input.countryIso2.toUpperCase(),
          status: "PENDING",
        },
      });
      if (input.partyType === "SUPPLIER") {
        await tx.supplierProfile.create({ data: { orgId: org.id } });
      } else {
        await tx.buyerProfile.create({ data: { orgId: org.id, buyerType: input.buyerType as BuyerType } });
      }
      const user = await tx.user.create({
        data: {
          emailEnc: this.crypto.encrypt(input.email),
          emailBidx,
          passwordHash: this.crypto.hashPassword(input.password),
          displayName: input.displayName,
          locale: input.locale ?? "en",
        },
      });
      await tx.membership.create({ data: { userId: user.id, orgId: org.id, orgRole: "OWNER" } });
      const role = await tx.role.findUniqueOrThrow({ where: { code: input.partyType } });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      await this.audit.logInTx(tx, { actorId: user.id, action: "REGISTER", targetType: "Organization", targetId: org.id, ip });
      await this.outbox.emitInTx(tx, `Organization:${org.id}`, "PartyRegistered", { orgId: org.id, publicCode: orgCode, partyType: input.partyType });
      return { userId: user.id, orgCode };
    });
    return result;
  }

  async login(email: string, password: string, ip?: string): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({
      where: { emailBidx: this.crypto.blindIndex(email), deletedAt: null },
      include: { roles: { where: { deletedAt: null }, include: { role: true } } },
    });
    if (!user?.passwordHash || !this.crypto.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException({ code: "AUTH_INVALID_CREDENTIALS", detail: "邮箱或密码错误" });
    }
    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException({ code: "AUTH_INVALID_CREDENTIALS", detail: "账号不可用" });
    }
    const membership = await this.prisma.membership.findFirst({ where: { userId: user.id, deletedAt: null } });
    const org = membership
      ? await this.prisma.organization.findUnique({ where: { id: membership.orgId } })
      : null;

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ actorId: user.id, action: "LOGIN", ip });

    return this.issueTokens({
      sub: user.id,
      roles: user.roles.map((r) => r.role.code),
      orgId: org?.id,
      orgCode: org?.publicCode,
      partyType: org?.partyType,
    });
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = this.crypto.sha256(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshHash: hash } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: "AUTH_TOKEN_EXPIRED", detail: "刷新令牌无效" });
    }
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
      include: { roles: { where: { deletedAt: null }, include: { role: true } } },
    });
    const membership = await this.prisma.membership.findFirst({ where: { userId: user.id, deletedAt: null } });
    const org = membership ? await this.prisma.organization.findUnique({ where: { id: membership.orgId } }) : null;
    return this.issueTokens({
      sub: user.id,
      roles: user.roles.map((r) => r.role.code),
      orgId: org?.id,
      orgCode: org?.publicCode,
      partyType: org?.partyType,
    });
  }

  /** 登录态修改密码：验旧密码，吊销全部旧会话，返回新令牌对保持登录 */
  async changePassword(userId: string, oldPassword: string, newPassword: string, ip?: string): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { roles: { where: { deletedAt: null }, include: { role: true } } },
    });
    if (!user?.passwordHash || !this.crypto.verifyPassword(oldPassword, user.passwordHash)) {
      throw new UnauthorizedException({ code: "AUTH_INVALID_CREDENTIALS", detail: "旧密码错误" });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: this.crypto.hashPassword(newPassword), version: { increment: 1 } },
      }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId: userId, action: "PASSWORD_CHANGED", targetType: "User", targetId: userId, ip });

    const membership = await this.prisma.membership.findFirst({ where: { userId, deletedAt: null } });
    const org = membership ? await this.prisma.organization.findUnique({ where: { id: membership.orgId } }) : null;
    return this.issueTokens({
      sub: user.id,
      roles: user.roles.map((r) => r.role.code),
      orgId: org?.id,
      orgCode: org?.publicCode,
      partyType: org?.partyType,
    });
  }

  /** 忘记密码：无论邮箱是否存在都返回成功（防枚举），存在则发重置链接 */
  async forgotPassword(email: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { emailBidx: this.crypto.blindIndex(email), deletedAt: null, status: "ACTIVE" },
    });
    if (!user) return;

    const token = randomBytes(32).toString("base64url");
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.crypto.sha256(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    });
    await this.audit.log({ actorId: user.id, action: "PASSWORD_RESET_REQUESTED", targetType: "User", targetId: user.id, ip });

    const copy = RESET_MAIL_COPY[user.locale] ?? RESET_MAIL_COPY.en!;
    const link = `${this.webUrl}/${user.locale === "zh-CN" ? "zh-CN" : user.locale}/reset-password?token=${token}`;
    await this.mail.send({ to: this.crypto.decrypt(user.emailEnc), subject: copy.subject, text: copy.body(link) });
  }

  /** 用重置令牌设置新密码；令牌一次性，成功后吊销全部会话 */
  async resetPassword(token: string, newPassword: string, ip?: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: this.crypto.sha256(token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: "AUTH_TOKEN_EXPIRED", detail: "重置链接无效或已过期" });
    }
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: this.crypto.hashPassword(newPassword), version: { increment: 1 } },
      }),
      this.prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId: record.userId, action: "PASSWORD_RESET_COMPLETED", targetType: "User", targetId: record.userId, ip });
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.crypto.sha256(refreshToken);
    await this.prisma.session.updateMany({ where: { refreshHash: hash }, data: { revokedAt: new Date() } });
  }

  private async issueTokens(payload: JwtPayload): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString("base64url");
    await this.prisma.session.create({
      data: {
        userId: payload.sub,
        refreshHash: this.crypto.sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlDays * 86_400_000),
      },
    });
    return { accessToken, refreshToken };
  }
}
