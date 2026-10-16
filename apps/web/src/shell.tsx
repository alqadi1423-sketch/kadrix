import { LOCALES, type Locale } from "@veloq/i18n";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "./api";
import { setLocale } from "./i18n";

const LOCALE_NAMES: Record<Locale, string> = { ar: "العربية", en: "English" };

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span className="sr-only">{t("common.language")}</span>
      <select
        className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-ink"
        value={i18n.language}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Brand() {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
      <span className="velocity-mark" aria-hidden />
      {t("app.name")}
    </span>
  );
}

export function Shell({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-ink no-underline">
            <Brand />
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            {signedIn && (
              <button
                className="text-sm text-muted hover:text-ink"
                onClick={() => authClient.signOut().then(() => window.location.assign("/"))}
              >
                {t("common.signOut")}
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
