import { formatDuration, parseDuration } from "@kadrix/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type CustomField, type Member } from "../api";
import { keys, useMe } from "../lib/hooks";
import { Button, ErrorText, Select } from "../ui";
import { Markdown } from "./markdown";

export const fieldKeys = {
  fields: (slug: string, projectId?: string) => ["ws", slug, "field", projectId ?? "all"] as const,
  values: (slug: string, issueId: string) => ["ws", slug, "issue", issueId, "fields"] as const,
  time: (slug: string, issueId: string) => ["ws", slug, "issue", issueId, "time"] as const,
};

export const useFields = (slug: string, projectId?: string) =>
  useQuery({ queryKey: fieldKeys.fields(slug, projectId), queryFn: () => api.fields(slug, projectId), select: (d) => d.fields });

const inputClass = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm";

/** One editor per field kind. `onChange(null)` clears the value. */
export function FieldInput({
  field,
  value,
  members,
  disabled,
  onChange,
}: {
  field: CustomField;
  value: unknown;
  members: Member[];
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const label = field.name;
  switch (field.kind) {
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-petrol" disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked || null)} />
          {t("fields.yes")}
        </label>
      );
    case "select":
      return (
        <Select aria-label={label} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} className="w-full">
          <option value="">{t("fields.none")}</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      );
    case "multiSelect": {
      const sel = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
          {field.options.map((o) => {
            const on = sel.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => onChange(on ? sel.filter((x) => x !== o.id) : [...sel, o.id])}
                className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-petrol bg-petrol/10 text-petrol" : "border-line text-muted"}`}
              >
                {o.name}
              </button>
            );
          })}
        </div>
      );
    }
    case "user":
      return (
        <Select aria-label={label} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} className="w-full">
          <option value="">{t("fields.none")}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      );
    case "date":
      return <input type="date" dir="ltr" aria-label={label} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} className={inputClass} />;
    default: {
      const kind = field.kind;
      return (
        <input
          key={String(value ?? "")}
          type={kind === "number" ? "number" : kind === "url" ? "url" : "text"}
          dir={kind === "text" ? "auto" : "ltr"}
          aria-label={label}
          disabled={disabled}
          defaultValue={value === null || value === undefined ? "" : String(value)}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const next = raw === "" ? null : kind === "number" ? Number(raw) : raw;
            if (next !== (value ?? null)) onChange(next);
          }}
          className={inputClass}
        />
      );
    }
  }
}

/** Custom fields in the issue sidebar. */
export function IssueFields({ slug, issueId, projectId, members, editable }: { slug: string; issueId: string; projectId: string; members: Member[]; editable: boolean }) {
  const qc = useQueryClient();
  const fields = useFields(slug, projectId);
  const values = useQuery({ queryKey: fieldKeys.values(slug, issueId), queryFn: () => api.issueFields(slug, issueId), select: (d) => d.values });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.updateIssue(slug, issueId, { fields: patch }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: fieldKeys.values(slug, issueId) });
      void qc.invalidateQueries({ queryKey: keys.issue(slug, issueId) });
    },
  });
  if (!fields.data?.length) return null;
  return (
    <div className="space-y-4 border-t border-line pt-4">
      {fields.data.map((f) => (
        <div key={f.id}>
          <div className="mb-1 text-xs text-muted" dir="auto">
            {f.name}
          </div>
          <FieldInput field={f} value={values.data?.[f.id] ?? null} members={members} disabled={!editable} onChange={(v) => save.mutate({ [f.id]: v })} />
        </div>
      ))}
      <ErrorText error={save.error} />
    </div>
  );
}

export function useDuration() {
  const { t, i18n } = useTranslation();
  const n = new Intl.NumberFormat(i18n.language);
  return (minutes: number) => {
    const { h, m } = formatDuration(minutes);
    if (!h) return t("time.m", { m: n.format(m) });
    if (!m) return t("time.h", { h: n.format(h) });
    return t("time.hm", { h: n.format(h), m: n.format(m) });
  };
}

/** Logged time on an issue, with a quick entry box that reads "1h 30m" or "١س ٣٠د". */
export function TimeSection({ slug, issueId, canLog, canModerate }: { slug: string; issueId: string; canLog: boolean; canModerate: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const dur = useDuration();
  const data = useQuery({ queryKey: fieldKeys.time(slug, issueId), queryFn: () => api.timeEntries(slug, issueId) });
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: fieldKeys.time(slug, issueId) });
  const log = useMutation({
    mutationFn: (input: { minutes: number; date: string; note: string }) => api.logTime(slug, issueId, input),
    onSuccess: () => {
      setText("");
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteTime(slug, id), onSuccess: refresh });
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const entries = data.data?.entries ?? [];
  if (!canLog && !entries.length) return null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("time.title")}</h2>
        {data.data && data.data.totalMinutes > 0 && <span className="text-sm text-muted">{dur(data.data.totalMinutes)}</span>}
      </div>
      {canLog && (
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const minutes = parseDuration(text);
            if (!minutes) return setBad(true);
            log.mutate({ minutes, date: String(f.get("date") || today), note: String(f.get("note") ?? "") });
          }}
        >
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setBad(false);
            }}
            placeholder={t("time.placeholder")}
            aria-label={t("time.duration")}
            aria-invalid={bad}
            dir="auto"
            className={`w-36 ${inputClass}`}
          />
          <input type="date" name="date" defaultValue={today} dir="ltr" aria-label={t("time.date")} className={`w-40 ${inputClass}`} />
          <input name="note" placeholder={t("time.note")} aria-label={t("time.note")} dir="auto" maxLength={500} className={`min-w-0 flex-1 ${inputClass}`} />
          <Button type="submit" disabled={!text.trim() || log.isPending}>
            {t("time.log")}
          </Button>
          {bad && (
            <p role="alert" className="basis-full text-sm text-danger">
              {t("time.invalid")}
            </p>
          )}
          <ErrorText error={log.error} />
        </form>
      )}
      {entries.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium">{dur(e.minutes)}</span>
              <span className="text-muted">{e.userName}</span>
              <time className="text-muted" dateTime={e.date}>
                {fmt.format(new Date(`${e.date}T00:00:00`))}
              </time>
              {e.note && (
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {e.note}
                </span>
              )}
              {(e.userId === me.data?.user.id || canModerate) && (
                <button className="ms-auto text-xs text-muted hover:text-danger" onClick={() => remove.mutate(e.id)}>
                  {t("common.delete")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const useAi = () => useQuery({ queryKey: ["ai"], queryFn: api.ai, staleTime: Infinity, select: (d) => d.enabled });

/** Shown only when the server has an AI provider switched on. */
export function AiSummary({ slug, issueId }: { slug: string; issueId: string }) {
  const { t } = useTranslation();
  const enabled = useAi();
  const run = useMutation({ mutationFn: () => api.aiSummary(slug, issueId) });
  if (!enabled.data) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">{t("ai.summary")}</h2>
        <Button variant="quiet" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? t("ai.summarizing") : t("ai.summarize")}
        </Button>
      </div>
      {run.data && (
        <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-3 text-sm">
          <Markdown text={run.data.summary} members={[]} />
          <p className="mt-2 text-xs text-muted">{t("ai.note")}</p>
        </div>
      )}
      <ErrorText error={run.error} />
    </section>
  );
}
