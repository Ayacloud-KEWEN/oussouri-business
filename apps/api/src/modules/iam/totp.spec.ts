import { generateTotpSecret, otpauthUrl, verifyTotp } from "./totp";

// RFC 6238 附录 B 测试向量（seed ASCII "12345678901234567890"，SHA-1，取后 6 位）
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it("matches RFC 6238 test vectors (last 6 digits)", () => {
    expect(verifyTotp(RFC_SECRET, "287082", 59_000)).toBe(true); // T=59 → 94287082
    expect(verifyTotp(RFC_SECRET, "081804", 1_111_111_109_000)).toBe(true); // → 07081804
    expect(verifyTotp(RFC_SECRET, "005924", 1_234_567_890_000)).toBe(true); // → 89005924
  });

  it("rejects wrong or malformed codes", () => {
    expect(verifyTotp(RFC_SECRET, "000000", 59_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "28708", 59_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", 59_000)).toBe(false);
  });

  it("tolerates ±1 time step drift", () => {
    expect(verifyTotp(RFC_SECRET, "287082", 59_000 + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, "287082", 59_000 + 61_000)).toBe(false);
  });

  it("generates 32-char base32 secrets accepted by verify", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUrl(secret, "ops")).toContain(secret);
  });
});
