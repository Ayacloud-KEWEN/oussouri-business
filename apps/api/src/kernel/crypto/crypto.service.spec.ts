import { ConfigService } from "@nestjs/config";
import { CryptoService } from "./crypto.service";

function makeService(): CryptoService {
  const keys: Record<string, string> = {
    PII_ENCRYPTION_KEY: "a".repeat(64),
    PII_BLIND_INDEX_KEY: "b".repeat(64),
  };
  return new CryptoService({ getOrThrow: (k: string) => keys[k] } as unknown as ConfigService);
}

describe("CryptoService（GBR-1 存储层防线）", () => {
  const service = makeService();

  it("加密后可解密还原（含中文与特殊字符）", () => {
    const samples = ["黑龙江华芝宝生物科技有限公司", "SAS JINGLIN PARIS", "+33 7 49 88 49 70", "a@b.fr / FR11948433925"];
    for (const s of samples) {
      expect(service.decrypt(service.encrypt(s))).toBe(s);
    }
  });

  it("相同明文两次加密产生不同密文（随机 IV）", () => {
    const a = Buffer.from(service.encrypt("secret")).toString("hex");
    const b = Buffer.from(service.encrypt("secret")).toString("hex");
    expect(a).not.toBe(b);
  });

  it("密文被篡改时解密抛错（GCM 认证）", () => {
    const enc = service.encrypt("secret");
    enc[enc.length - 1] = enc[enc.length - 1]! ^ 0xff;
    expect(() => service.decrypt(enc)).toThrow();
  });

  it("盲索引对大小写与空白归一化，等值可查", () => {
    expect(service.blindIndex("  Contact@Oussouri.FR ")).toBe(service.blindIndex("contact@oussouri.fr"));
    expect(service.blindIndex("a@b.fr")).not.toBe(service.blindIndex("c@d.fr"));
  });

  it("口令散列可验证、错误口令拒绝", () => {
    const hash = service.hashPassword("OussouriDev2026!");
    expect(service.verifyPassword("OussouriDev2026!", hash)).toBe(true);
    expect(service.verifyPassword("wrong-password", hash)).toBe(false);
    expect(service.verifyPassword("x", "malformed")).toBe(false);
  });
});
