/** 编码规则实体（D1 决策：公开代码不含地域信息，GBR-2） */
export const CODE_ENTITIES = {
  SUPPLIER: { prefix: "SP", pattern: "{prefix}-{seq:6}" },
  BUYER: { prefix: "BY", pattern: "{prefix}-{seq:6}" },
  PRODUCT: { prefix: "PRD", pattern: "{prefix}-{seq:6}" },
  ORDER: { prefix: "ORD", pattern: "{prefix}-{date:YYYYMMDD}-{seq:5}" },
  AUCTION: { prefix: "AUC", pattern: "{prefix}-{date:YYYYMMDD}-{seq:4}" },
  RFQ: { prefix: "RFQ", pattern: "{prefix}-{date:YYYYMMDD}-{seq:4}" },
  FUTURES: { prefix: "FUT", pattern: "{prefix}-{date:YYYYMMDD}-{seq:4}" },
  INVOICE: { prefix: "INV", pattern: "{prefix}-{date:YYYYMMDD}-{seq:5}" },
  OPPORTUNITY: { prefix: "OPP", pattern: "{prefix}-{seq:6}" },
} as const;
export type CodeEntityType = keyof typeof CODE_ENTITIES;
