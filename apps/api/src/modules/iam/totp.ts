import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP（SHA-1 / 6 位 / 30 秒步长，与 Google Authenticator 等兼容）。
 * 自实现避免引入依赖；secret 以 base32 呈现给用户，密文存 totpSecretEnc。
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("非法 base32 字符");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).toString().padStart(DIGITS, "0");
  return code;
}

/** 校验 6 位动态码，容忍 ±1 个时间窗（时钟漂移） */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secret);
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  for (const delta of [0, -1, 1]) {
    const expected = hotp(key, counter + delta);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, accountLabel: string): string {
  return `otpauth://totp/${encodeURIComponent("Oussouri HUB")}:${encodeURIComponent(accountLabel)}?secret=${secret}&issuer=${encodeURIComponent("Oussouri HUB")}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
