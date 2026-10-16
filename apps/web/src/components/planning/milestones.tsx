import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api";
import { Button, ErrorText, Field } from "../../ui";

export function MilestonesTab({ slug, projectId, canManage }: { slug: string; projectId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["ws", slug, "milestone", projectId];
  const list = useQuery({ queryKey: key, queryFn: () => api.milestones(slug, projectId) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: (input: { name: string; targetDate: string | null }) => api.createMilestone(slug, projectId, input),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteMilestone(slug, id), onSuccess: refresh });
  const items = list.data?.milestones ?? [];

  return (
    <div className="space-y-4">
      {list.isSuccess && items.length === 0 && <p className="text-muted">{t("milestones.empty")}</p>}
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        {items.map((m) => {
          const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="size-2.5 rotate-45 bg-signal" aria-hidden />
              <span className="font-medium" dir="auto">
                {m.name}
              </span>
              {m.targetDate && (
                <span className="text-sm text-muted tabular-nums" dir="ltr">
                  {m.targetDate}
                </span>
              )}
              <span className="ms-auto flex items-center gap-2 text-sm text-muted">
                {t("cycles.progress", { done: m.done, total: m.total })}
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-paper" aria-hidden>
                  <span className="block h-full rounded-full bg-petrol" style={{ inlineSize: `${pct}%` }} />
                </span>
              </span>
              {canManage && (
                <button className="text-sm text-muted hover:text-danger" onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(m.id)}>
                  {t("common.delete")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-dashed border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            create.mutate({ name: String(f.get("name")), targetDate: String(f.get("targetDate") || "") || null }, { onSuccess: () => form.reset() });
          }}
        >
          <div className="min-w-48 flex-1">
            <Field label={t("milestones.name")} name="name" required maxLength={80} dir="auto" />
          </div>
          <Field label={t("milestones.targetDate")} name="targetDate" type="date" dir="ltr" />
          <Button type="submit" disabled={create.isPending}>
            {t("milestones.create")}
          </Button>
          <div className="basis-full">
            <ErrorText error={create.error} />
          </div>
        </form>
      )}
    </div>
  );
}
