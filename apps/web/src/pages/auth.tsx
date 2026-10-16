import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "../api";
import { Brand, LanguageSwitch } from "../shell";
import { Button, Field } from "../ui";

export function AuthPage({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (res.error) setError(res.error.message ?? t("errors.generic"));
    else onDone();
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
          <Field
            label={t("auth.password")}
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            dir="ltr"
          />
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
