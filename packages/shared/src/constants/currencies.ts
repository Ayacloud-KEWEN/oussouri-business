export const SUPPORTED_CURRENCIES = ["EUR", "USD", "CNY", "GBP", "JPY"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
export const BASE_CURRENCY: Currency = "EUR";
/** 小数位（GBR-4；JPY 0 位） */
export const CURRENCY_DECIMALS: Record<Currency, number> = {
  EUR: 2, USD: 2, CNY: 2, GBP: 2, JPY: 0,
};
