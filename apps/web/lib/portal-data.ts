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

/** 产区介绍摘自公开报道（中新网/湖北日报/云南网等，2023–2026）；产量为行业公开量级，具体以主体档案为准 */
export const ORIGINS = [
  {
    name: { "zh-CN": "黑龙江省", en: "Heilongjiang", fr: "Heilongjiang" },
    region: { "zh-CN": "抚远 · 佳木斯（华夏东极）", en: "Fuyuan · Jiamusi", fr: "Fuyuan · Jiamusi" },
    species: "Kaluga (Huso dauricus), Amur (Schrenckii), Hybrids",
    outputKg: "180,000+",
    img: "/origins/heilongjiang.webp",
    desc: {
      "zh-CN": "达氏鳇与施氏鲟的原生水域，国家地理标志「抚远鲟鳇鱼子酱」产地。杂交新品种「鲟龙1号」支撑年出口鱼子酱 180 余吨，黑龙江冷水赋予鱼子紧实颗粒与坚果尾韵。",
      en: "Native waters of Kaluga and Amur sturgeon and home of the GI-protected Fuyuan caviar. The Xunlong No.1 hybrid underpins 180+ tonnes of annual exports; cold Amur River water yields firm pearls with a nutty finish.",
      fr: "Eaux natales du kaluga et de l'esturgeon de l'Amour, origine du caviar IGP de Fuyuan. L'hybride « Xunlong n°1 » soutient plus de 180 t d'exportations par an ; l'eau froide de l'Amour donne un grain ferme aux notes de noisette.",
    },
  },
  {
    name: { "zh-CN": "浙江省", en: "Zhejiang", fr: "Zhejiang" },
    region: { "zh-CN": "千岛湖 · 衢州", en: "Qiandao Lake · Quzhou", fr: "Lac Qiandao · Quzhou" },
    species: "Kaluga hybrids, Osetra, Baerii",
    outputKg: "250,000+",
    img: "/origins/zhejiang.webp",
    desc: {
      "zh-CN": "全球最大鱼子酱产区：千岛湖一类水体养殖，「卡露伽」连续十年销量全球第一，2024 年出口约 230 吨——世界上每三罐鱼子酱就有一罐产自这里，供应汉莎头等舱与米其林三星。",
      en: "The world's largest caviar origin: raised in Qiandao Lake's Class-I waters, Kaluga Queen has led global sales for ten straight years with ~230 t exported in 2024 — one in three tins worldwide — served in first class cabins and 3-star kitchens.",
      fr: "Première origine mondiale du caviar : élevé dans les eaux de classe I du lac Qiandao, Kaluga Queen domine les ventes mondiales depuis dix ans (~230 t exportées en 2024) — une boîte sur trois dans le monde — servi en première classe et chez les 3 étoiles.",
    },
  },
  {
    name: { "zh-CN": "湖北省", en: "Hubei", fr: "Hubei" },
    region: { "zh-CN": "宜都 · 清江鲟鱼谷", en: "Yidu · Qingjiang Sturgeon Valley", fr: "Yidu · Vallée aux esturgeons de Qingjiang" },
    species: "Siberian Sturgeon, Hybrids",
    outputKg: "100,000+",
    img: "/origins/hubei.webp",
    desc: {
      "zh-CN": "清江鲟鱼谷拥有全球最大单体室内工厂化养殖车间，存栏成年鲟鱼 110 余万尾，鱼子酱出口量约占全国三成，2024 年产量突破 100 吨，全程可控温可追溯。",
      en: "Qingjiang Sturgeon Valley runs the world's largest single indoor recirculating farm with 1.1M+ adult sturgeon; it ships roughly 30% of China's caviar exports, topping 100 t in 2024 with full temperature control and traceability.",
      fr: "La vallée de Qingjiang exploite la plus grande ferme intérieure au monde (plus de 1,1 M d'esturgeons adultes) ; environ 30 % des exportations chinoises, plus de 100 t en 2024, en circuit fermé traçable.",
    },
  },
  {
    name: { "zh-CN": "广东省", en: "Guangdong", fr: "Guangdong" },
    region: { "zh-CN": "粤北山区冷泉", en: "Northern Guangdong springs", fr: "Sources du nord du Guangdong" },
    species: "Baerii, Hybrids",
    outputKg: "2,800+",
    img: "/origins/guangdong.webp",
    desc: {
      "zh-CN": "粤北韶关、清远山区利用山涧冷泉流水养殖西伯利亚鲟与杂交鲟，毗邻粤港澳大湾区消费市场与广州空运口岸，鲜品与鱼子酱出货时效领先。",
      en: "Cold mountain-spring raceways around Shaoguan and Qingyuan grow Siberian and hybrid sturgeon next door to the Greater Bay Area market and Guangzhou's air cargo hub — the fastest farm-to-flight lead times.",
      fr: "Les bassins d'eau de source des monts de Shaoguan et Qingyuan élèvent esturgeons sibériens et hybrides aux portes de la Grande Baie et du fret aérien de Canton — délais ferme-avion imbattables.",
    },
  },
  {
    name: { "zh-CN": "湖南省", en: "Hunan", fr: "Hunan" },
    region: { "zh-CN": "资兴 · 东江湖", en: "Zixing · Dongjiang Lake", fr: "Zixing · Lac Dongjiang" },
    species: "Siberian Sturgeon, Hybrids",
    outputKg: "5,000+",
    img: "/origins/hunan.webp",
    desc: {
      "zh-CN": "东江湖深层湖水常年 8–13℃，水质国家一级，是华南少有的天然冷水鱼场。当地以「公司+基地+农户」模式养殖鲟鱼，高龄亲鱼储备量大，鱼子酱产能正快速释放。",
      en: "Dongjiang Lake's deep water holds 8–13°C year-round at national Class-I quality — a rare natural cold-water fishery in South China. A company-base-farmer model has built a deep stock of mature broodfish, with caviar capacity ramping fast.",
      fr: "Les eaux profondes du lac Dongjiang restent à 8–13 °C toute l'année (qualité classe I) — rare pêcherie d'eau froide du sud de la Chine. Le modèle « entreprise-base-éleveurs » a constitué un fort cheptel de géniteurs ; la capacité caviar monte vite.",
    },
  },
  {
    name: { "zh-CN": "云南省", en: "Yunnan", fr: "Yunnan" },
    region: { "zh-CN": "会泽 · 中国鲟鱼谷", en: "Huize · China Sturgeon Valley", fr: "Huize · Vallée chinoise aux esturgeons" },
    species: "Beluga (Huso huso), Kaluga, Russian Sturgeon, Hybrids",
    outputKg: "30,000+",
    img: "/origins/yunnan.webp",
    desc: {
      "zh-CN": "高原天然冷泉养殖带，全国鲟鱼养殖产量前列（年约 2.7 万吨）。会泽「中国鲟鱼谷」与阿穆尔集团育有欧洲鳇、达氏鳇等 30 万尾以上，2024 年出口鱼子酱超 30 吨、远销欧美。",
      en: "A plateau belt of natural cold springs and one of China's top sturgeon provinces (~27,000 t of fish a year). Huize's China Sturgeon Valley and the Amur Group hold 300k+ Beluga, Kaluga and other sturgeon, exporting 30+ t of caviar to Europe and the US in 2024.",
      fr: "Ceinture de sources froides d'altitude, parmi les premières provinces d'élevage (~27 000 t de poissons/an). La vallée de Huize et le groupe Amur détiennent plus de 300 000 bélugas, kalugas et autres esturgeons ; plus de 30 t de caviar exportées vers l'Europe et les États-Unis en 2024.",
    },
  },
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
