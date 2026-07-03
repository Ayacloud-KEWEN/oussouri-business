export const SUPPORTED_LOCALES = ["zh-CN", "en", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** 渲染回退链：fr → en → zh-CN（GBR-3） */
export const LOCALE_FALLBACK_CHAIN: Record<Locale, Locale[]> = {
  "zh-CN": ["zh-CN", "en", "fr"],
  en: ["en", "fr", "zh-CN"],
  fr: ["fr", "en", "zh-CN"],
};
