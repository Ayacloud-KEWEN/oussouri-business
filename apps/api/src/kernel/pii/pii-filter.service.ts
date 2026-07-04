import { Injectable } from "@nestjs/common";

export interface PiiMatch {
  rule: string;
  excerpt: string;
}

/**
 * PII/联系方式拦截（GBR-1 出口层、M17 FR-17-02）。
 * 正则通道；NER 通道 P3 由 ai-platform 增强。
 */
@Injectable()
export class PiiFilterService {
  private readonly rules: { name: string; pattern: RegExp }[] = [
    // 国际/中国/法国手机与座机（宽松匹配连续 8+ 位含分隔符）
    { name: "PHONE", pattern: /(?:\+?\d[\s\-.()]?){8,15}\d/ },
    { name: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
    { name: "WECHAT", pattern: /(微信|weixin|wechat|vx|wx)[:：\s]*[a-zA-Z][a-zA-Z0-9_-]{5,19}/i },
    { name: "WHATSAPP", pattern: /whats?app/i },
    { name: "URL", pattern: /(https?:\/\/|www\.)[^\s]{4,}/i },
    { name: "IBAN", pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/ },
  ];

  scan(text: string): PiiMatch[] {
    // 平台公开编码（ORD-20261120-00001 / SP-000018 等）是合法沟通内容，
    // 先剔除再扫描，避免其数字段被 PHONE 规则误判
    const scrubbed = text.replace(/\b[A-Z]{2,4}-\d{8}-\d{4,6}\b/g, " ").replace(/\b[A-Z]{2,4}-\d{4,8}\b/g, " ");
    const matches: PiiMatch[] = [];
    for (const { name, pattern } of this.rules) {
      const m = scrubbed.match(pattern);
      if (m?.[0]) matches.push({ rule: name, excerpt: m[0].slice(0, 50) });
    }
    return matches;
  }
}
