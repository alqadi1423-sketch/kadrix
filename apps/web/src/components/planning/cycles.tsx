import { addDays, formatDate } from "@kadrix/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type Cycle } from "../../api";
import { useIssues, useLabels, useMembers, useProject } from "../../lib/hooks";
import { Button, ErrorText, Field } from "../../ui";
import { LineChart } from "../charts";
import { IssueList } from "../issue-list";

const STATUS_STYLE: Record<Cycle["status"], string> = {
  active: "bg-petrol text-white dark:text-ink",
  upcoming: "border border-line text-muted",
  completed: "bg-paper text-muted",
  overdue: "bg-signal/20 text-ink",
};

export function CyclesTab({ slug, projectId, canManage }: { slug: string; projectId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["ws", slug, "cycle", projectId];
  const list = useQuery({ queryKey: key, queryFn: () => api.cycles(slug, projectId) });
  const [open, setOpen] = useState<string | null>(null);
  const cycles = list.data?.cycles ?? [];
  const current = open ?? cycles.find((c) => c.status === "active" || c.status === "overdue")?.id ?? null;

  const last = cycles.at(-1);
  const nextStart = last ? addDays(last.endsOn, 1) : formatDate(new Date());
  const create = useMutation({
    mutationFn: (input: { name?: string; startsOn: string; endsOn: string }) => api.createCycle(slug, projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      name: String(f.get("name") || "") || undefined,
      startsOn: String(f.get("startsOn")),
      endsOn: String(f.get("endsOn")),
    });
  }

  return (
    <div className="space-y-4">
      {list.data?.velocity != null && <p className="text-sm text-muted">{t("cycles.velocity", { value: list.data.velocity })}</p>}
      {list.isSuccess && cycles.length === 0 && <p className="text-muted">{t("cycles.empty")}</p>}
      <ul className="space-y-2">
        {[...cycles].reverse().map((c) => {
          const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
          const isOpen = current === c.id;
          return (
            <li key={c.id} className="rounded-[var(--radius-panel)] border border-line bg-surface">
              <button
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? "" : c.id)}
              >
                <span className="font-medium">{c.name || t("cycles.numbered", { number: c.number })}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[c.status]}`}>{t(`cycles.status.${c.status}`)}</span>
                <span className="text-sm text-muted tabular-nums" dir="ltr">
                  {c.startsOn} → {c.endsOn}
                </span>
                <span className="ms-auto flex items-center gap-2 text-sm text-muted">
                  {t("cycles.progress", { done: c.done, total: c.total })}
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-paper" aria-hidden>
                    <span className="block h-full rounded-full bg-petrol" style={{ inlineSize: `${pct}%` }} />
                  </span>
                </span>
              </button>
              {isOpen && <CycleDetail slug={slug} projectId={projectId} cycle={c} canManage={canManage} onChanged={() => qc.invalidateQueries({ queryKey: key })} />}
            </li>
          );
        })}
      </ul>
      {canManage && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-dashed border-line p-4">
          <div className="min-w-40 flex-1">
            <Field label={t("cycles.name")} name="name" maxLength={60} dir="auto" />
          </div>
          <Field label={t("cycles.startsOn")} name="startsOn" type="date" required defaultValue={nextStart} key={`s${nextStart}`} dir="ltr" />
          <Field label={t("cycles.endsOn")} name="endsOn" type="date" required defaultValue={addDays(nextStart, 13)} key={`e${nextStart}`} dir="ltr" />
          <Button type="submit" disabled={create.isPending}>
            {t("cycles.create")}
          </Button>
          <div className="basis-full">
            <ErrorText error={create.error} />
          </div>
        </form>
      )}
    </div>
  );
}

function CycleDetail({
  slug,
  projectId,
  cycle,
  canManage,
  onChanged,
}: {
  slug: string;
  projectId: string;
  cycle: Cycle;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const burn = useQuery({ queryKey: ["ws", slug, "cycle", cycle.id, "burndown"], queryFn: () => api.burndown(slug, cycle.id) });
  const issues = useIssues(slug, { cycleId: cycle.id, includeClosed: true });
  const project = useProject(slug, projectId);
  const labels = useLabels(slug);
  const members = useMembers(slug);
  const [note, setNote] = useState<string | null>(null);
  const complete = useMutation({
    mutationFn: () => api.completeCycle(slug, cycle.id),
    onSuccess: (r) => {
      setNote(t("cycles.rolledOver", { count: r.rolledOver }));
      onChanged();
    },
  });
  const pts = burn.data?.points ?? [];
  const unit = burn.data ? t(`cycles.${burn.data.unit}`) : "";
  return (
    <div className="space-y-4 border-t border-line p-4">
      {burn.data && (
        <p className="text-sm text-muted">
          {t("cycles.workingDays", { count: burn.data.workingDays })} · {unit}
        </p>
      )}
      {pts.length > 0 && (
        <LineChart
          title={`${t("cycles.burndown")} (${unit})`}
          labels={pts.map((p) => p.date)}
          series={[
            { name: t("cycles.remaining"), color: "var(--color-chart-1)", values: pts.map((p) => p.remaining) },
            { name: t("cycles.scope"), color: "var(--color-chart-2)", values: pts.map((p) => p.scope) },
            { name: t("cycles.ideal"), color: "var(--color-muted)", values: pts.map((p) => p.ideal), dashed: true },
          ]}
        />
      )}
      {issues.data && issues.data.length > 0 && (
        <IssueList
          slug={slug}
          issues={issues.data}
          states={project.data?.states}
          labels={labels.data ?? []}
          members={members.data ?? []}
          canEdit={canManage}
        />
      )}
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
      <ErrorText error={complete.error} />
      {canManage && !cycle.completedAt && (
        <Button variant="quiet" onClick={() => window.confirm(t("cycles.completeConfirm")) && complete.mutate()}>
          {t("cycles.complete")}
        </Button>
      )}
    </div>
  );
}
