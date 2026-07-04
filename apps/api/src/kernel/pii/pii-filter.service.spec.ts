import { PiiFilterService } from "./pii-filter.service";

describe("PiiFilterService（M17 联系方式拦截）", () => {
  const filter = new PiiFilterService();

  it.each([
    ["法国手机", "请直接联系我 +33 7 49 88 49 70", "PHONE"],
    ["中国手机", "我电话13845678901随时打", "PHONE"],
    ["邮箱", "发我邮箱 chef@restaurant.fr 谢谢", "EMAIL"],
    ["微信", "加微信: caviar_king88 细聊", "WECHAT"],
    ["WhatsApp", "on my whatsapp please", "WHATSAPP"],
    ["网址", "详情见 https://my-shop.example.com/contact", "URL"],
    ["IBAN", "打款到 FR7630006000011234567890189", "IBAN"],
  ])("拦截：%s", (_name, text, rule) => {
    const matches = filter.scan(text);
    expect(matches.map((m) => m.rule)).toContain(rule);
  });

  it.each([
    ["正常询价", "请问这批鱼子酱的颗粒大小是多少？"],
    ["含数量", "我需要 50kg，规格 100g 罐装，下周交货"],
    ["法语正常", "Quelle est la taille des grains de ce caviar ?"],
    ["含订单号", "订单 ORD-20261120-00001 什么时候发货"],
  ])("放行：%s", (_name, text) => {
    expect(filter.scan(text)).toHaveLength(0);
  });
});
