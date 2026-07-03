/** 11 角色 RBAC（masterprompt TARGET USERS） */
export const ROLES = [
  "GUEST",
  "BUYER",
  "SUPPLIER",
  "BROKER",
  "CUSTOMER_SERVICE",
  "QUALITY_INSPECTOR",
  "LOGISTICS_OPERATOR",
  "CUSTOMS_OFFICER",
  "FINANCE",
  "ADMIN",
  "SUPER_ADMIN",
] as const;
export type RoleCode = (typeof ROLES)[number];

/** 内部角色（强制 2FA，Broker 及以上） */
export const INTERNAL_ROLES: readonly RoleCode[] = [
  "BROKER",
  "CUSTOMER_SERVICE",
  "QUALITY_INSPECTOR",
  "LOGISTICS_OPERATOR",
  "CUSTOMS_OFFICER",
  "FINANCE",
  "ADMIN",
  "SUPER_ADMIN",
];

export const DATA_SCOPES = ["OWN", "PARTY", "ALL"] as const;
export type DataScope = (typeof DATA_SCOPES)[number];
