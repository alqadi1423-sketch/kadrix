import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "../api";
import { Brand, LanguageSwitch } from "../shell";
import { Button, Field } from "../ui";

export function AuthPage({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"signIn" | "signUp" | "code">("signIn");
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  function authMessage(err: { code?: string; status?: number }) {
    if (err.status === 429) return t("errors.rateLimited");
    // The server only accepts requests from its own address (BASE_URL).
    if (err.status === 403 || err.code === "INVALID_ORIGIN") return t("auth.wrongAddress");
    switch (err.code) {
      case "WEAK_PASSWORD":
        return t("auth.weakPassword");
      case "PASSWORD_TOO_SHORT":
        return t("auth.shortPassword");
      case "INVALID_EMAIL_OR_PASSWORD":
        return t("auth.badCredentials");
      case "USER_ALREADY_EXISTS":
      case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
        return t("auth.emailTaken");
      default:
        // Keep the code visible so problems can be reported precisely.
        return `${t("errors.generic")} (${err.status ?? "?"} ${err.code ?? ""})`.replace(" )", ")");
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setBusy(true);
    setError(null);
    const res =
      mode === "signUp"
        ? await authClient.signUp.email({ name: String(f.get("name")), email, password })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) setError(authMessage(res.error));
    else if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) setMode("code");
    else onDone();
  }

  async function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const code = String(f.get("code")).replace(/\s/g, "");
    setBusy(true);
    setError(null);
    const res = backup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice: f.get("trust") === "on" });
    setBusy(false);
    if (res.error) setError(res.error.status === 429 ? t("errors.rateLimited") : t("twoFactor.wrongCode"));
    else onDone();
  }

  if (mode === "code") {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between">
            <Brand />
            <LanguageSwitch />
          </div>
          <h1 className="mb-1 text-2xl font-semibold">{t("twoFactor.title")}</h1>
          <p className="mb-6 text-muted">{backup ? t("twoFactor.backupHint") : t("twoFactor.enterCode")}</p>
          <form onSubmit={submitCode} className="space-y-4">
            <Field
              key={String(backup)}
              label={backup ? t("twoFactor.backupCodes") : t("twoFactor.code")}
              name="code"
              required
              autoFocus
              dir="ltr"
              autoComplete="one-time-code"
              inputMode={backup ? "text" : "numeric"}
              pattern={backup ? undefined : "[0-9 ]{6,7}"}
            />
            {!backup && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="trust" className="accent-petrol" />
                {t("twoFactor.trustDevice")}
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {t("twoFactor.verify")}
            </Button>
          </form>
          <button className="mt-6 text-sm text-petrol underline" onClick={() => setBackup(!backup)}>
            {backup ? t("twoFactor.useApp") : t("twoFactor.useBackup")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-between">
          <Brand />
          <LanguageSwitch />
        </div>
        <h1 className="mb-1 text-2xl font-semibold">{t(mode === "signIn" ? "auth.signIn" : "auth.signUp")}</h1>
        <p className="mb-6 text-muted">{t("app.tagline")}</p>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signUp" && <Field label={t("auth.name")} name="name" required autoComplete="name" />}
          <Field label={t("auth.email")} name="email" type="email" required autoComplete="email" dir="ltr" />
          <div>
            <Field
              label={t("auth.password")}
              name="password"
              type={show ? "text" : "password"}
              required
              minLength={mode === "signUp" ? 15 : undefined}
              maxLength={128}
              autoComplete={mode === "signUp" ? "new-password" : "current-password"}
              dir="auto"
              aria-describedby={mode === "signUp" ? "password-hint" : undefined}
            />
            <div className="mt-1 flex items-start justify-between gap-3 text-xs text-muted">
              {mode === "signUp" ? <p id="password-hint">{t("auth.passwordHint")}</p> : <span />}
              <button type="button" className="shrink-0 text-petrol" aria-pressed={show} onClick={() => setShow(!show)}>
                {t(show ? "auth.hidePassword" : "auth.showPassword")}
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {t(mode === "signIn" ? "auth.signIn" : "auth.signUp")}
          </Button>
        </form>
        <p className="mt-6 text-sm text-muted">
          {t(mode === "signIn" ? "auth.noAccount" : "auth.haveAccount")}{" "}
          <button className="text-petrol underline" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
            {t(mode === "signIn" ? "auth.signUp" : "auth.signIn")}
          </button>
        </p>
      </div>
    </div>
  );
}
