import { renderCodePattern } from "./code-pattern.util";

describe("renderCodePattern（GBR-2 编码引擎）", () => {
  const day = new Date(Date.UTC(2026, 10, 20)); // 2026-11-20

  it("序列格式：SP-000018", () => {
    expect(renderCodePattern("{prefix}-{seq:6}", "SP", 6, 18n)).toBe("SP-000018");
  });

  it("日期+序列格式：ORD-20261120-00007", () => {
    expect(renderCodePattern("{prefix}-{date:YYYYMMDD}-{seq:5}", "ORD", 5, 7n, day)).toBe("ORD-20261120-00007");
  });

  it("序列超出补零位数时不截断", () => {
    expect(renderCodePattern("{prefix}-{seq:4}", "AUC", 4, 123456n)).toBe("AUC-123456");
  });

  it("公开编码不含地域信息（决策 D1 回归锚点）", () => {
    const code = renderCodePattern("{prefix}-{seq:6}", "SP", 6, 42n);
    expect(code).not.toMatch(/HLJ|CN|FR/);
  });
});
