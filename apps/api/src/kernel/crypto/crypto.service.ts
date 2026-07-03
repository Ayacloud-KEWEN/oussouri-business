import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * PII 列级加密（GBR-1 存储层防线）
 * 密文格式: [12B IV][16B authTag][ciphertext]，AES-256-GCM
 * 盲索引: HMAC-SHA256(normalize(value))，仅支持等值查询
 */
@Injectable()
export class CryptoService {
  private readonly encKey: Buffer;
  private readonly bidxKey: Buffer;

  constructor(config: ConfigService) {
    this.encKey = Buffer.from(config.getOrThrow<string>("PII_ENCRYPTION_KEY"), "hex");
    this.bidxKey = Buffer.from(config.getOrThrow<string>("PII_BLIND_INDEX_KEY"), "hex");
  }

  encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encKey, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const packed = Buffer.concat([iv, cipher.getAuthTag(), enc]);
    // 复制到独立 ArrayBuffer（Buffer 池共享底层，Prisma Bytes 需要 Uint8Array<ArrayBuffer>）
    const out = new Uint8Array(packed.length);
    out.set(packed);
    return out;
  }

  decrypt(payload: Buffer | Uint8Array): string {
    const buf = Buffer.from(payload);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.encKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }

  /** 盲索引（大小写/空白归一化后 HMAC） */
  blindIndex(value: string): string {
    const normalized = value.trim().toLowerCase();
    return createHmac("sha256", this.bidxKey).update(normalized).digest("hex");
  }

  /** 口令散列（scrypt N=2^15, r=8, p=1；格式 salt:hash hex） */
  hashPassword(password: string): string {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return `${salt.toString("hex")}:${hash.toString("hex")}`;
  }

  verifyPassword(password: string, stored: string): boolean {
    const [saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) return false;
    const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
  }

  sha256(value: string): string {
    return createHmac("sha256", "session").update(value).digest("hex");
  }
}
