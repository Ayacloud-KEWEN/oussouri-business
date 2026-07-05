/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedRoles(): Promise<void> {
  const roles: { code: string; isInternal: boolean }[] = [
    { code: "GUEST", isInternal: false },
    { code: "BUYER", isInternal: false },
    { code: "SUPPLIER", isInternal: false },
    { code: "BROKER", isInternal: true },
    { code: "CUSTOMER_SERVICE", isInternal: true },
    { code: "QUALITY_INSPECTOR", isInternal: true },
    { code: "LOGISTICS_OPERATOR", isInternal: true },
    { code: "CUSTOMS_OFFICER", isInternal: true },
    { code: "FINANCE", isInternal: true },
    { code: "ADMIN", isInternal: true },
    { code: "SUPER_ADMIN", isInternal: true },
  ];
  for (const role of roles) {
    await prisma.role.upsert({ where: { code: role.code }, create: role, update: { isInternal: role.isInternal } });
  }
}

async function seedCodeRules(): Promise<void> {
  const rules = [
    { entityType: "SUPPLIER", prefix: "SP", pattern: "{prefix}-{seq:6}" },
    { entityType: "BUYER", prefix: "BY", pattern: "{prefix}-{seq:6}" },
    { entityType: "PRODUCT", prefix: "PRD", pattern: "{prefix}-{seq:6}" },
    { entityType: "ORDER", prefix: "ORD", pattern: "{prefix}-{date:YYYYMMDD}-{seq:5}", seqLength: 5 },
    { entityType: "AUCTION", prefix: "AUC", pattern: "{prefix}-{date:YYYYMMDD}-{seq:4}", seqLength: 4 },
    { entityType: "RFQ", prefix: "RFQ", pattern: "{prefix}-{date:YYYYMMDD}-{seq:4}", seqLength: 4 },
    { entityType: "FUTURES", prefix: "FUT", pattern: "{prefix}-{date:YYYYMMDD}-{seq:4}", seqLength: 4 },
    { entityType: "INVOICE", prefix: "INV", pattern: "{prefix}-{date:YYYYMMDD}-{seq:5}", seqLength: 5 },
    { entityType: "OPPORTUNITY", prefix: "OPP", pattern: "{prefix}-{seq:6}" },
  ];
  for (const rule of rules) {
    await prisma.codeRule.upsert({ where: { entityType: rule.entityType }, create: rule, update: {} });
  }
}

async function seedOrderStateMachine(): Promise<void> {
  await prisma.stateMachine.upsert({
    where: { code: "ORDER" },
    create: {
      code: "ORDER",
      states: [
        "DRAFT", "PLACED", "PAID_ESCROW", "CONFIRMED", "PREPARING", "SHIPPED",
        "IN_CUSTOMS", "CUSTOMS_CLEARED", "DELIVERED", "COMPLETED", "CANCELLED", "DISPUTED", "RESOLVED",
      ],
    },
    update: {},
  });
  const transitions: { from: string; to: string; roles: string[]; emits?: string }[] = [
    { from: "DRAFT", to: "PLACED", roles: ["BUYER"], emits: "OrderPlaced" },
    { from: "PLACED", to: "PAID_ESCROW", roles: ["SYSTEM"], emits: "OrderPaid" },
    { from: "PLACED", to: "CANCELLED", roles: ["BUYER", "ADMIN"], emits: "OrderCancelled" },
    { from: "PAID_ESCROW", to: "CONFIRMED", roles: ["SUPPLIER"], emits: "OrderConfirmed" },
    { from: "CONFIRMED", to: "PREPARING", roles: ["SUPPLIER"] },
    { from: "PREPARING", to: "SHIPPED", roles: ["SUPPLIER"], emits: "OrderShipped" },
    { from: "CONFIRMED", to: "SHIPPED", roles: ["SUPPLIER"], emits: "OrderShipped" },
    { from: "SHIPPED", to: "IN_CUSTOMS", roles: ["LOGISTICS_OPERATOR", "CUSTOMS_OFFICER", "ADMIN"] },
    { from: "IN_CUSTOMS", to: "CUSTOMS_CLEARED", roles: ["CUSTOMS_OFFICER", "ADMIN"] },
    { from: "CUSTOMS_CLEARED", to: "DELIVERED", roles: ["BUYER", "SYSTEM"], emits: "OrderDelivered" },
    { from: "SHIPPED", to: "DELIVERED", roles: ["BUYER", "SYSTEM"], emits: "OrderDelivered" },
    { from: "DELIVERED", to: "COMPLETED", roles: ["SYSTEM"], emits: "OrderCompleted" },
    { from: "DELIVERED", to: "DISPUTED", roles: ["BUYER", "SUPPLIER"], emits: "OrderDisputed" },
    { from: "DISPUTED", to: "RESOLVED", roles: ["ADMIN", "CUSTOMER_SERVICE"], emits: "DisputeResolved" },
  ];
  for (const t of transitions) {
    await prisma.stateTransition.upsert({
      where: { machineCode_fromState_toState: { machineCode: "ORDER", fromState: t.from, toState: t.to } },
      create: { machineCode: "ORDER", fromState: t.from, toState: t.to, allowedRoles: t.roles, emitsEvent: t.emits },
      update: { allowedRoles: t.roles, emitsEvent: t.emits ?? null },
    });
  }
}

async function seedP2StateMachines(): Promise<void> {
  // OPPORTUNITY（M13 FR-13-05）
  await prisma.stateMachine.upsert({
    where: { code: "OPPORTUNITY" },
    create: { code: "OPPORTUNITY", states: ["NEW", "CONTACTED", "NEGOTIATING", "WON", "LOST"] },
    update: {},
  });
  const oppTransitions = [
    { from: "NEW", to: "CONTACTED", roles: ["BROKER", "ADMIN"] },
    { from: "CONTACTED", to: "NEGOTIATING", roles: ["BROKER", "ADMIN"] },
    { from: "NEGOTIATING", to: "WON", roles: ["BROKER", "ADMIN", "SYSTEM"], emits: "OpportunityWon" },
    { from: "NEW", to: "LOST", roles: ["BROKER", "ADMIN"] },
    { from: "CONTACTED", to: "LOST", roles: ["BROKER", "ADMIN"] },
    { from: "NEGOTIATING", to: "LOST", roles: ["BROKER", "ADMIN"] },
  ];
  for (const t of oppTransitions) {
    await prisma.stateTransition.upsert({
      where: { machineCode_fromState_toState: { machineCode: "OPPORTUNITY", fromState: t.from, toState: t.to } },
      create: { machineCode: "OPPORTUNITY", fromState: t.from, toState: t.to, allowedRoles: t.roles, emitsEvent: t.emits },
      update: { allowedRoles: t.roles, emitsEvent: t.emits ?? null },
    });
  }
  // RFQ（M07）
  await prisma.stateMachine.upsert({
    where: { code: "RFQ" },
    create: { code: "RFQ", states: ["OPEN", "QUOTING", "ACCEPTED", "EXPIRED", "CANCELLED"] },
    update: {},
  });
  const rfqTransitions = [
    { from: "OPEN", to: "QUOTING", roles: ["SUPPLIER", "SYSTEM"] },
    { from: "OPEN", to: "CANCELLED", roles: ["BUYER", "ADMIN"] },
    { from: "QUOTING", to: "ACCEPTED", roles: ["BUYER"], emits: "RfqAccepted" },
    { from: "QUOTING", to: "CANCELLED", roles: ["BUYER", "ADMIN"] },
    { from: "OPEN", to: "EXPIRED", roles: ["SYSTEM"] },
    { from: "QUOTING", to: "EXPIRED", roles: ["SYSTEM"] },
  ];
  for (const t of rfqTransitions) {
    await prisma.stateTransition.upsert({
      where: { machineCode_fromState_toState: { machineCode: "RFQ", fromState: t.from, toState: t.to } },
      create: { machineCode: "RFQ", fromState: t.from, toState: t.to, allowedRoles: t.roles, emitsEvent: t.emits },
      update: { allowedRoles: t.roles, emitsEvent: t.emits ?? null },
    });
  }
  // SHIPMENT（M10）
  await prisma.stateMachine.upsert({
    where: { code: "SHIPMENT" },
    create: { code: "SHIPMENT", states: ["PREPARING", "IN_TRANSIT", "ARRIVED", "DELIVERED", "EXCEPTION"] },
    update: {},
  });
  const shipmentTransitions = [
    { from: "PREPARING", to: "IN_TRANSIT", roles: ["SUPPLIER", "LOGISTICS_OPERATOR", "SYSTEM", "ADMIN"] },
    { from: "IN_TRANSIT", to: "ARRIVED", roles: ["LOGISTICS_OPERATOR", "ADMIN"] },
    { from: "ARRIVED", to: "DELIVERED", roles: ["LOGISTICS_OPERATOR", "SYSTEM", "ADMIN"] },
    { from: "IN_TRANSIT", to: "EXCEPTION", roles: ["LOGISTICS_OPERATOR", "SYSTEM", "ADMIN"] },
  ];
  for (const t of shipmentTransitions) {
    await prisma.stateTransition.upsert({
      where: { machineCode_fromState_toState: { machineCode: "SHIPMENT", fromState: t.from, toState: t.to } },
      create: { machineCode: "SHIPMENT", fromState: t.from, toState: t.to, allowedRoles: t.roles },
      update: { allowedRoles: t.roles },
    });
  }
  // CUSTOMS（M11）
  await prisma.stateMachine.upsert({
    where: { code: "CUSTOMS" },
    create: { code: "CUSTOMS", states: ["DRAFT", "SUBMITTED", "INSPECTION", "CLEARED", "REJECTED"] },
    update: {},
  });
  const customsTransitions = [
    { from: "DRAFT", to: "SUBMITTED", roles: ["CUSTOMS_OFFICER", "ADMIN"], emits: "CustomsSubmitted" },
    { from: "SUBMITTED", to: "INSPECTION", roles: ["CUSTOMS_OFFICER", "ADMIN"] },
    { from: "SUBMITTED", to: "CLEARED", roles: ["CUSTOMS_OFFICER", "ADMIN"], emits: "CustomsCleared" },
    { from: "INSPECTION", to: "CLEARED", roles: ["CUSTOMS_OFFICER", "ADMIN"], emits: "CustomsCleared" },
    { from: "INSPECTION", to: "REJECTED", roles: ["CUSTOMS_OFFICER", "ADMIN"] },
  ];
  for (const t of customsTransitions) {
    await prisma.stateTransition.upsert({
      where: { machineCode_fromState_toState: { machineCode: "CUSTOMS", fromState: t.from, toState: t.to } },
      create: { machineCode: "CUSTOMS", fromState: t.from, toState: t.to, allowedRoles: t.roles, emitsEvent: t.emits },
      update: { allowedRoles: t.roles, emitsEvent: t.emits ?? null },
    });
  }
  for (const code of ["ORDER_PAYMENT_LINK", "OPPORTUNITY_NEW", "RFQ_QUOTED", "TEMP_BREACH"]) {
    await prisma.notificationTemplate.upsert({
      where: { code },
      create: { code, channels: ["INAPP", "EMAIL"] },
      update: {},
    });
  }
}

async function seedCategories(): Promise<void> {
  const categories = [
    { code: "CAVIAR", industryTemplate: "STURGEON", sortOrder: 1 },
    { code: "FISH_MEAT", industryTemplate: "STURGEON", sortOrder: 2 },
    { code: "FISH_SKIN", industryTemplate: "STURGEON", sortOrder: 3 },
    { code: "CARTILAGE", industryTemplate: "STURGEON", sortOrder: 4 },
    { code: "ROE", industryTemplate: "STURGEON", sortOrder: 5 },
    { code: "TRUFFLE", industryTemplate: "TRUFFLE", sortOrder: 10 },
    { code: "WAGYU", industryTemplate: "WAGYU", sortOrder: 11 },
    { code: "SEAFOOD", industryTemplate: "SEAFOOD", sortOrder: 12 },
    { code: "WINE", industryTemplate: "WINE", sortOrder: 13 },
  ];
  for (const c of categories) {
    await prisma.category.upsert({ where: { code: c.code }, create: c, update: {} });
  }
}

async function seedSpecies(): Promise<void> {
  const species: { code: string; latinName: string; citesAppendix?: string; fatherCode?: string; motherCode?: string }[] = [
    { code: "SIN", latinName: "Acipenser sinensis", citesAppendix: "Appendix I" },
    { code: "DAB", latinName: "Acipenser dabryanus", citesAppendix: "Appendix I" },
    { code: "DAU", latinName: "Huso dauricus", citesAppendix: "Appendix II" },
    { code: "SCH", latinName: "Acipenser schrenckii", citesAppendix: "Appendix II" },
    { code: "BAE", latinName: "Acipenser baerii", citesAppendix: "Appendix II" },
    { code: "RUT", latinName: "Acipenser ruthenus", citesAppendix: "Appendix II" },
    { code: "HUS", latinName: "Huso huso", citesAppendix: "Appendix II" },
    { code: "GUE", latinName: "Acipenser gueldenstaedtii", citesAppendix: "Appendix II" },
    { code: "SPA", latinName: "Polyodon spathula", citesAppendix: "Appendix II" },
    { code: "STE", latinName: "Acipenser stellatus", citesAppendix: "Appendix II" },
    { code: "DAUHUS", latinName: "Huso dauricus × Huso huso", fatherCode: "DAU", motherCode: "HUS" },
    { code: "SCHHUS", latinName: "Acipenser schrenckii × Huso huso", fatherCode: "SCH", motherCode: "HUS" },
    { code: "GUEHUS", latinName: "Acipenser gueldenstaedtii × Huso huso", fatherCode: "GUE", motherCode: "HUS" },
    { code: "BAEHUS", latinName: "Acipenser baerii × Huso huso", fatherCode: "BAE", motherCode: "HUS" },
    { code: "RUTHUS", latinName: "Acipenser ruthenus × Huso huso", fatherCode: "RUT", motherCode: "HUS" },
    { code: "DAUSCH", latinName: "Huso dauricus × Acipenser schrenckii", fatherCode: "DAU", motherCode: "SCH" },
    { code: "SCHDAU", latinName: "Acipenser schrenckii × Huso dauricus", fatherCode: "SCH", motherCode: "DAU" },
  ];
  for (const s of species) {
    await prisma.species.upsert({ where: { code: s.code }, create: s, update: {} });
  }
}

async function seedGrades(): Promise<void> {
  const grades = [
    { code: "G001", categoryCode: "CAVIAR", criteria: { eggSizeMm: ">=3.5", species: ["DAU"] } },
    { code: "G002", categoryCode: "CAVIAR", criteria: { eggSizeMm: ">=3.0", species: ["DAU", "SCH"] } },
    { code: "G003", categoryCode: "CAVIAR", criteria: { eggSizeMm: ">=3.0", species: ["SCH"] } },
    { code: "G004", categoryCode: "CAVIAR", criteria: { custom: true, species: ["DAU"] } },
  ];
  for (const g of grades) {
    await prisma.grade.upsert({ where: { code: g.code }, create: g, update: {} });
  }
  // 等级三语名称（EntityTranslation 需要 entityId，用 code 查回）
  const names: Record<string, Record<string, string>> = {
    G001: { "zh-CN": "赫哲传承级", fr: "Héritage Hezhe", en: "Hezhe Heritage" },
    G002: { "zh-CN": "黑龙珍珠级", fr: "Perle du Dragon Noir", en: "Black Dragon Pearl" },
    G003: { "zh-CN": "极地甘露级", fr: "Nectar Polaire", en: "Polar Nectar" },
    G004: { "zh-CN": "鳇鱼定制级", fr: "Sur Mesure", en: "Bespoke Kaluga" },
  };
  for (const [code, locales] of Object.entries(names)) {
    const grade = await prisma.grade.findUniqueOrThrow({ where: { code } });
    for (const [locale, value] of Object.entries(locales)) {
      await prisma.entityTranslation.upsert({
        where: { entityType_entityId_field_locale: { entityType: "Grade", entityId: grade.id, field: "name", locale } },
        create: { entityType: "Grade", entityId: grade.id, field: "name", locale, value, status: "REVIEWED" },
        update: { value },
      });
    }
  }
}

async function seedCountriesAndFx(): Promise<void> {
  const countries = [
    { iso2: "FR", currencyCode: "EUR", vatRate: 20, euMember: true },
    { iso2: "DE", currencyCode: "EUR", vatRate: 19, euMember: true },
    { iso2: "IT", currencyCode: "EUR", vatRate: 22, euMember: true },
    { iso2: "ES", currencyCode: "EUR", vatRate: 21, euMember: true },
    { iso2: "CN", currencyCode: "CNY", vatRate: 13, euMember: false },
    { iso2: "US", currencyCode: "USD", euMember: false },
    { iso2: "GB", currencyCode: "GBP", vatRate: 20, euMember: false },
    { iso2: "JP", currencyCode: "JPY", vatRate: 10, euMember: false },
  ];
  for (const c of countries) {
    await prisma.country.upsert({ where: { iso2: c.iso2 }, create: c, update: {} });
  }
  const asOf = new Date();
  const rates = [
    { quote: "USD", rate: 1.09 },
    { quote: "CNY", rate: 7.8 },
    { quote: "GBP", rate: 0.85 },
    { quote: "JPY", rate: 168 },
  ];
  for (const r of rates) {
    await prisma.exchangeRate.upsert({
      where: { base_quote_asOf: { base: "EUR", quote: r.quote, asOf } },
      create: { base: "EUR", quote: r.quote, rate: r.rate, source: "SEED", asOf },
      update: {},
    });
  }
}

async function seedCommissionAndDocs(): Promise<void> {
  const existing = await prisma.commissionRule.findFirst({ where: { categoryCode: null, deletedAt: null } });
  if (!existing) {
    await prisma.commissionRule.create({
      data: { ratePct: 0.08, effectiveFrom: new Date("2026-01-01"), priority: 0 },
    });
  }
  await prisma.docRequirementTemplate.upsert({
    where: { categoryCode_exportCountry_importCountry: { categoryCode: "CAVIAR", exportCountry: "CN", importCountry: "FR" } },
    create: {
      categoryCode: "CAVIAR",
      exportCountry: "CN",
      importCountry: "FR",
      requiredDocTypes: ["COMMERCIAL_INVOICE", "CITES", "ORIGIN_CERT", "PACKING_LIST", "AWB", "SANITARY_CERT", "HEALTH_CERT"],
    },
    update: {},
  });
  for (const code of ["ORDER_PAID", "ORDER_SHIPPED", "ACCESS_ESCALATION", "PARTY_APPROVED", "CERT_EXPIRING"]) {
    await prisma.notificationTemplate.upsert({
      where: { code },
      create: { code, channels: ["INAPP", "EMAIL"] },
      update: {},
    });
  }
}

async function seedInternalUsers(): Promise<void> {
  // 开发用内部账号（admin@oussouri.local / superadmin@oussouri.local，密码 OussouriDev2026!）
  // 加密依赖运行时密钥，此处仅在 AUTH 通过 API 注册后由脚本赋角色更安全；
  // 为冒烟便利，直接用与 API 相同算法生成（须与 .env 密钥一致，由 smoke 脚本处理）。
  console.log("内部账号请通过 scripts/smoke 或管理端创建后赋角色");
}

async function main(): Promise<void> {
  await seedRoles();
  await seedCodeRules();
  await seedOrderStateMachine();
  await seedP2StateMachines();
  await seedCategories();
  await seedSpecies();
  await seedGrades();
  await seedCountriesAndFx();
  await seedCommissionAndDocs();
  await seedInternalUsers();
  console.log("Seed 完成");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
