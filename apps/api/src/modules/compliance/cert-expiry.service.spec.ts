import { CertExpiryService } from "./cert-expiry.service";

describe("CertExpiryService.bucketOf", () => {
  it("已过期落 EXPIRED 档", () => {
    expect(CertExpiryService.bucketOf(-1)).toBe("EXPIRED");
    expect(CertExpiryService.bucketOf(-400)).toBe("EXPIRED");
  });

  it("命中最小的仍覆盖剩余天数的档位", () => {
    expect(CertExpiryService.bucketOf(0)).toBe("7");
    expect(CertExpiryService.bucketOf(7)).toBe("7");
    expect(CertExpiryService.bucketOf(8)).toBe("30");
    expect(CertExpiryService.bucketOf(30)).toBe("30");
    expect(CertExpiryService.bucketOf(31)).toBe("60");
    expect(CertExpiryService.bucketOf(60)).toBe("60");
  });

  it("超出最大档位不提醒", () => {
    expect(CertExpiryService.bucketOf(61)).toBeNull();
    expect(CertExpiryService.bucketOf(365)).toBeNull();
  });
});
