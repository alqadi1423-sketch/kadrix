import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { ApiCallError } from "./api";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger" }) {
  const look = {
    primary: "bg-petrol text-white hover:bg-petrol-strong dark:text-ink",
    quiet: "text-petrol hover:bg-petrol/10",
    danger: "text-danger hover:bg-danger/10",
  }[variant];
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

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm text-ink ${className}`}
      {...props}
    />
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

/** Native <dialog>: focus trapping, Escape and backdrop for free. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={`m-auto w-[calc(100%-2rem)] rounded-[var(--radius-panel)] border border-line bg-surface p-0 text-ink backdrop:bg-ink/40 ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      {open && (
        <div className="p-5">
          <h2 className="mb-4 text-lg font-semibold">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-muted">{children}</p>;
}
