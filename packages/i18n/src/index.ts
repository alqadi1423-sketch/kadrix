import { ar } from "./ar.js";
import { en, type Messages } from "./en.js";

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const messages: Record<Locale, Messages> = { ar, en };

export function directionOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Error codes the API returns; each has a translation under `errors`. */
export type ErrorCode = keyof Messages["errors"];

export type { Messages };
