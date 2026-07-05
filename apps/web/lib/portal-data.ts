/**
 * 门户首页展示数据（P1 演示数据；P2 起由 intelligence / rfq API 供给）。
 * 名称按 locale 提供，数字与代码语言无关。
 */
export interface LocalizedName { "zh-CN": string; en: string; fr: string }

export const PLATFORM_STATS = [
  { key: "statFarms", value: "88+" },
  { key: "statBuyers", value: "126+" },
  { key: "statProducts", value: "256+" },
  { key: "statDeals", value: "1,250+" },
  { key: "statCountries", value: "18+" },
] as const;

export const MARKET_INSIGHTS = {
  updatedAt: "2026-07-01",
  rows: [
    { species: "Beluga", spec: "100g+", origin: { "zh-CN": "黑龙江", en: "Heilongjiang", fr: "Heilongjiang" }, price: "6,850", trend: 2.3 },
    { species: "Osetra", spec: "100g+", origin: { "zh-CN": "浙江", en: "Zhejiang", fr: "Zhejiang" }, price: "4,250", trend: 1.8 },
    { species: "Sevruga", spec: "50g+", origin: { "zh-CN": "黑龙江", en: "Heilongjiang", fr: "Heilongjiang" }, price: "2,150", trend: 0.9 },
    { species: "Baerii", spec: "50g+", origin: { "zh-CN": "广东", en: "Guangdong", fr: "Guangdong" }, price: "1,250", trend: -0.4 },
    { species: "Siberian Sturgeon", spec: "100g+", origin: { "zh-CN": "湖北", en: "Hubei", fr: "Hubei" }, price: "1,650", trend: 1.2 },
  ],
};

export const ORIGINS = [
  { name: { "zh-CN": "黑龙江省", en: "Heilongjiang", fr: "Heilongjiang" }, species: "Beluga, Osetra, Sevruga", outputKg: "12,000+", tone: "#1d3a5f" },
  { name: { "zh-CN": "浙江省", en: "Zhejiang", fr: "Zhejiang" }, species: "Osetra, Baerii", outputKg: "8,500+", tone: "#1f4a52" },
  { name: { "zh-CN": "湖北省", en: "Hubei", fr: "Hubei" }, species: "Siberian Sturgeon", outputKg: "3,200+", tone: "#254a2e" },
  { name: { "zh-CN": "广东省", en: "Guangdong", fr: "Guangdong" }, species: "Baerii", outputKg: "2,800+", tone: "#4a3a1f" },
];

/** 买家需求：按身份防火墙原则以平台代码 + 类型展示（GBR-1） */
export const BUYER_DEMANDS = [
  { code: "BY-000126", type: { "zh-CN": "法国 · 高端食品批发商", en: "France · Fine food wholesaler", fr: "France · Grossiste épicerie fine" }, species: "Beluga", spec: "100g+", qtyKg: 50, deliveryBy: "2026-08-15" },
  { code: "BY-000098", type: { "zh-CN": "法国 · 进口商", en: "France · Importer", fr: "France · Importateur" }, species: "Osetra", spec: "100g+", qtyKg: 80, deliveryBy: "2026-08-20" },
  { code: "BY-000174", type: { "zh-CN": "意大利 · 高端鱼子酱供应商", en: "Italy · Premium caviar supplier", fr: "Italie · Fournisseur caviar premium" }, species: "Sevruga", spec: "50g+", qtyKg: 30, deliveryBy: "2026-08-10" },
  { code: "BY-000211", type: { "zh-CN": "德国 · 进口分销商", en: "Germany · Import distributor", fr: "Allemagne · Distributeur importateur" }, species: "Baerii", spec: "50g+", qtyKg: 60, deliveryBy: "2026-08-18" },
  { code: "BY-000057", type: { "zh-CN": "法国 · 米其林餐厅集团", en: "France · Michelin restaurant group", fr: "France · Groupe de restaurants étoilés" }, species: "Beluga", spec: "100g+", qtyKg: 40, deliveryBy: "2026-08-25" },
];

export const RFQ_LIST = [
  { code: "RFQ-20260628-0519", species: "Beluga", spec: "100g+", qtyKg: 100, deadline: "2026-07-28", open: true },
  { code: "RFQ-20260627-0518", species: "Osetra", spec: "100g+", qtyKg: 70, deadline: "2026-07-27", open: true },
  { code: "RFQ-20260625-0517", species: "Sevruga", spec: "50g+", qtyKg: 50, deadline: "2026-07-25", open: true },
  { code: "RFQ-20260620-0516", species: "Baerii", spec: "50g+", qtyKg: 80, deadline: "2026-06-24", open: false },
  { code: "RFQ-20260618-0515", species: { "zh-CN": "多品种鱼子酱", en: "Mixed caviar", fr: "Caviar assorti" }, spec: { "zh-CN": "混合规格", en: "Mixed specs", fr: "Formats variés" }, qtyKg: 120, deadline: "2026-06-20", open: false },
];
