/** 编码模式渲染（纯函数，便于测试）：{prefix} {seq:N} {date:YYYYMMDD} */
export function renderCodePattern(pattern: string, prefix: string, seqLength: number, seq: bigint, now: Date = new Date()): string {
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  return pattern
    .replace("{prefix}", prefix)
    .replace(/\{seq:(\d+)\}/, (_, n: string) => seq.toString().padStart(Math.max(Number(n), seqLength), "0"))
    .replace("{date:YYYYMMDD}", date);
}
