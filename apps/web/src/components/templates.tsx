import { ISSUE_TYPES, PRIORITY_KEYS, RECURRENCE_FREQ } from "@veloq/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useMembers } from "../lib/hooks";
import { Button, ErrorText, Field, Panel, Select } from "../ui";

export const templateKey = (slug: string, projectId: string) => ["ws", slug, "template", projectId] as const;
export const useTemplates = (slug: string, projectId: string) =>
  useQuery({ queryKey: templateKey(slug, projectId), queryFn: () => api.templates(slug, projectId), select: (d) => d.templates, enabled: !!projectId });

/** Project tab: issue templates and the schedules that repeat them. */
export function TemplatesTab({ slug, projectId, canManage }: { slug: string; projectId: string; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const templates = useTemplates(slug, projectId);
  const members = useMembers(slug);
  const recurrences = useQuery({ queryKey: ["ws", slug, "recurrence"], queryFn: () => api.recurrences(slug), select: (d) => d.recurrences.filter((r) => r.projectId === projectId) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["ws", slug, "template"] });
    void qc.invalidateQueries({ queryKey: ["ws", slug, "recurrence"] });
  };
  const create = useMutation({ mutationFn: (input: Record<string, unknown>) => api.createTemplate(slug, input), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteTemplate(slug, id), onSuccess: refresh });
  const repeat = useMutation({ mutationFn: (input: Record<string, unknown>) => api.createRecurrence(slug, input), onSuccess: refresh });
  const toggle = useMutation({ mutationFn: (r: { id: string; active: boolean }) => api.setRecurrenceActive(slug, r.id, !r.active), onSuccess: refresh });
  const unrepeat = useMutation({ mutationFn: (id: string) => api.deleteRecurrence(slug, id), onSuccess: refresh });
  const [freq, setFreq] = useState<(typeof RECURRENCE_FREQ)[number]>("weekly");
  const [days, setDays] = useState<number[]>([0]);
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const dayName = (d: number) => new Intl.DateTimeFormat(i18n.language, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 4 + d)));
  const today = new Date().toISOString().slice(0, 10);
  const list = templates.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title={t("templates.title")}>
        {list.length ? (
          <ul className="mb-4 divide-y divide-line">
            {list.map((tp) => (
              <li key={tp.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium" dir="auto">
                    {tp.name}
                  </div>
                  {tp.title && (
                    <div className="truncate text-xs text-muted" dir="auto">
                      {tp.title}
                    </div>
                  )}
                </div>
                {canManage && (
                  <Button variant="danger" onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(tp.id)}>
                    {t("common.delete")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-muted">{t("templates.empty")}</p>
        )}
        {canManage && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              create.mutate(
                {
                  projectId,
                  name: String(f.get("name")),
                  title: String(f.get("title") ?? ""),
                  description: String(f.get("description") ?? ""),
                  type: String(f.get("type")),
                  priority: Number(f.get("priority")),
                  assigneeId: String(f.get("assigneeId")) || null,
                },
                { onSuccess: () => form.reset() },
              );
            }}
          >
            <Field label={t("templates.name")} name="name" required maxLength={80} dir="auto" />
            <Field label={t("templates.issueTitle")} name="title" maxLength={250} dir="auto" />
            <label className="block">
              <span className="mb-1 block text-sm text-muted">{t("templates.description")}</span>
              <textarea name="description" rows={4} dir="auto" className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Select name="type" aria-label={t("issueTypes.label")} defaultValue="task">
                {ISSUE_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t(`issueTypes.${k}`)}
                  </option>
                ))}
              </Select>
              <Select name="priority" aria-label={t("priority.label")} defaultValue="0">
                {PRIORITY_KEYS.map((k, i) => (
                  <option key={k} value={i}>
                    {t(`priority.${k}`)}
                  </option>
                ))}
              </Select>
              <Select name="assigneeId" aria-label={t("issues.assignee")} defaultValue="">
                <option value="">{t("issues.unassigned")}</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={create.isPending}>
              {t("templates.add")}
            </Button>
            <ErrorText error={create.error} />
          </form>
        )}
      </Panel>

      <Panel title={t("recurrence.title")}>
        {recurrences.data?.length ? (
          <ul className="mb-4 divide-y divide-line">
            {recurrences.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium" dir="auto">
                    {r.templateName}
                  </div>
                  <div className="text-xs text-muted">
                    {t(`recurrence.freq.${r.freq}`)}
                    {r.freq === "weekly" && ` · ${r.weekdays.map(dayName).join("، ")}`}
                    {r.freq === "monthly" && ` · ${r.dayOfMonth}`} ·{" "}
                    {r.active ? t("recurrence.next", { date: fmt.format(new Date(`${r.nextDate}T00:00:00`)) }) : t("recurrence.paused")}
                  </div>
                </div>
                {canManage && (
                  <>
                    <Button variant="quiet" onClick={() => toggle.mutate(r)}>
                      {r.active ? t("recurrence.pause") : t("recurrence.resume")}
                    </Button>
                    <Button variant="danger" onClick={() => window.confirm(t("common.confirmDelete")) && unrepeat.mutate(r.id)}>
                      {t("common.delete")}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-muted">{t("recurrence.empty")}</p>
        )}
        {canManage && list.length > 0 && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              repeat.mutate({
                templateId: String(f.get("templateId")),
                freq,
                interval: Number(f.get("interval") || 1),
                weekdays: freq === "weekly" ? days : [],
                dayOfMonth: freq === "monthly" ? Number(f.get("dayOfMonth")) : null,
                startDate: String(f.get("startDate") || today),
              });
            }}
          >
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-sm text-muted">{t("recurrence.template")}</span>
                <Select name="templateId" required>
                  {list.map((tp) => (
                    <option key={tp.id} value={tp.id}>
                      {tp.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-muted">{t("recurrence.every")}</span>
                <input type="number" name="interval" min={1} max={12} defaultValue={1} className="w-16 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm" />
              </label>
              <Select value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)} aria-label={t("recurrence.every")}>
                {RECURRENCE_FREQ.map((x) => (
                  <option key={x} value={x}>
                    {t(`recurrence.freq.${x}`)}
                  </option>
                ))}
              </Select>
              <label className="block">
                <span className="mb-1 block text-sm text-muted">{t("recurrence.start")}</span>
                <input type="date" name="startDate" defaultValue={today} dir="ltr" className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm" />
              </label>
            </div>
            {freq === "weekly" && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("recurrence.weekdays")}>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                  const on = days.includes(d);
                  return (
                    <button
                      type="button"
                      key={d}
                      aria-pressed={on}
                      onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d].sort())}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-petrol bg-petrol/10 text-petrol" : "border-line text-muted"}`}
                    >
                      {dayName(d)}
                    </button>
                  );
                })}
              </div>
            )}
            {freq === "monthly" && (
              <Field label={t("recurrence.dayOfMonth")} name="dayOfMonth" type="number" min={1} max={31} defaultValue={1} required hint={t("recurrence.lastDayNote")} />
            )}
            <Button type="submit" disabled={repeat.isPending || (freq === "weekly" && !days.length)}>
              {t("recurrence.add")}
            </Button>
            <ErrorText error={repeat.error} />
          </form>
        )}
      </Panel>
    </div>
  );
}
