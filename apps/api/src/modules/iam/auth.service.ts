import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../kernel/prisma/prisma.service";
import { CryptoService } from "../../kernel/crypto/crypto.service";
import { CodeGeneratorService } from "../../kernel/codegen/code-generator.service";
import { AuditService } from "../../kernel/audit/audit.service";
import { OutboxService } from "../../kernel/outbox/outbox.service";
import type { JwtPayload } from "./auth.types";
import type { BuyerType, PartyType } from "@prisma/client";

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
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly codegen: CodeGeneratorService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.refreshTtlDays = Number(config.get("REFRESH_TOKEN_TTL_DAYS") ?? 30);
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
