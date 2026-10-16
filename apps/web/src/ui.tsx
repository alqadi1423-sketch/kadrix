import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiCallError } from "./api";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" }) {
  const look =
    variant === "primary"
      ? "bg-petrol text-white hover:bg-petrol-strong dark:text-ink"
      : "text-petrol hover:bg-petrol/10";
  return (
    <button
      className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${look} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <input
        className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-petrol"
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const code = error instanceof ApiCallError ? error.code : "generic";
  return (
    <p role="alert" className="text-sm text-danger">
      {t(`errors.${code}`)}
    </p>
  );
}

export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
