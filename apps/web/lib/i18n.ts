import zhCN from "@/messages/zh-CN.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

export const LOCALES = ["zh-CN", "en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export type Dictionary = typeof en;

const dictionaries: Record<Locale, Dictionary> = { "zh-CN": zhCN as Dictionary, en, fr: fr as Dictionary };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function getDictionary(locale: string): Dictionary {
  return isLocale(locale) ? dictionaries[locale] : dictionaries[DEFAULT_LOCALE];
}

/** 简单插值：t("auth.registered", {code}) 由调用方 replace */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}
