import { directionOf, isLocale, messages, type Locale } from "@kadrix/i18n";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const STORAGE_KEY = "kadrix.locale";

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // storage may be unavailable; fall through
  }
  return navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
}

function applyToDocument(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = directionOf(locale);
}

const locale = initialLocale();
applyToDocument(locale);

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: messages.ar },
    en: { translation: messages.en },
  },
  lng: locale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLocale(next: Locale) {
  applyToDocument(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  void i18n.changeLanguage(next);
  // Emails follow the language people use in the app.
  void fetch("/api/me/preferences", {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locale: next }),
  }).catch(() => {});
}

export { i18n };
