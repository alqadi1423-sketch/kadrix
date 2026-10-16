import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { BarChart, LineChart } from "../components/charts";
import { useDuration } from "../components/extend";
import { useProjects } from "../lib/hooks";
import { ErrorText, Panel, Select } from "../ui";

const RANGES = { last30: 30, last90: 90, last180: 180 } as const;

/** Flow reports: how long work takes, how much gets done, where it piles up. */
export function ReportsPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { t, i18n } = useTranslation();
  const projects = useProjects(slug);
  const [projectId, setProjectId] = useState("");
  const [range, setRange] = useState<keyof typeof RANGES>("last30");
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - (RANGES[range] - 1) * 864e5).toISOString().slice(0, 10);
  const report = useQuery({ queryKey: ["ws", slug, "issues", "report", projectId, range], queryFn: () => api.report(slug, { projectId: projectId || undefined, from, to }) });
  const n = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric", timeZone: "UTC" });
  const dur = useDuration();
  const r = report.data;
  const days = (v: number | null) => (v === null ? "—" : t("reports.days", { n: n.format(v) }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="me-auto text-2xl font-semibold">{t("reports.title")}</h1>
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={t("issues.project")}>
          <option value="">{t("reports.allProjects")}</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)} aria-label={t("reports.range")}>
          {Object.keys(RANGES).map((k) => (
            <option key={k} value={k}>
              {t(`reports.${k}`)}
            </option>
          ))}
        </Select>
      </header>
      <ErrorText error={report.error} />
      {!r ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Stat label={t("reports.completed")} value={n.format(r.flow.completed)} />
            <Stat label={t("reports.leadTime")} hint={t("reports.leadHint")} value={days(r.flow.leadP50)} sub={`${t("reports.p85")} ${days(r.flow.leadP85)}`} />
            <Stat label={t("reports.cycleTime")} hint={t("reports.cycleHint")} value={days(r.flow.cycleP50)} sub={`${t("reports.p85")} ${days(r.flow.cycleP85)}`} />
          </section>
          {r.flow.completed === 0 && <p className="text-sm text-muted">{t("reports.noData")}</p>}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <BarChart labels={r.throughput.map((w) => day.format(new Date(`${w.weekEnding}T00:00:00Z`)))} values={r.throughput.map((w) => w.done)} title={t("reports.throughput")} />
            </Card>
            <Card>
              <LineChart
                title={t("reports.cfd")}
                labels={r.cfd.map((d) => d.date)}
                series={[
                  { name: t("stateCategories.completed"), color: "var(--color-chart-1)", values: r.cfd.map((d) => d.completed) },
                  { name: t("stateCategories.started"), color: "var(--color-chart-2)", values: r.cfd.map((d) => d.completed + d.started) },
                  {
                    name: t("stateCategories.unstarted"),
                    color: "var(--color-chart-3)",
                    values: r.cfd.map((d) => d.completed + d.started + d.unstarted + d.backlog + d.triage),
                  },
                ]}
              />
            </Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title={t("reports.workload")}>
              <PeopleTable
                rows={r.workload.map((w) => ({ key: w.userId ?? "none", name: w.name ?? t("reports.unassigned"), value: w.open, label: `${n.format(w.open)} · ${n.format(w.estimate)}` }))}
                head={[t("reports.person"), `${t("reports.open")} · ${t("reports.estimate")}`]}
              />
            </Panel>
            <Panel title={t("reports.timeLogged")}>
              <PeopleTable
                rows={r.time.map((w) => ({ key: w.userId ?? "none", name: w.name ?? "?", value: w.minutes, label: dur(w.minutes) }))}
                head={[t("reports.person"), t("time.title")]}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">{children}</section>;
}

function Stat({ label, value, hint, sub }: { label: string; value: string; hint?: string; sub?: string }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** A table with an in-row bar: the number is always printed, the bar only helps compare. */
function PeopleTable({ rows, head }: { rows: { key: string; name: string; value: number; label: string }[]; head: [string, string] }) {
  const { t } = useTranslation();
  if (!rows.length) return <p className="text-sm text-muted">{t("reports.noData")}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <table className="w-full text-sm">
      <thead className="sr-only">
        <tr>
          <th>{head[0]}</th>
          <th>{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-line last:border-0">
            <td className="w-1/3 py-2 pe-3" dir="auto">
              {r.name}
            </td>
            <td className="py-2">
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 rounded-full bg-paper">
                  <div className="h-2 rounded-full bg-[var(--color-chart-1)]" style={{ inlineSize: `${(r.value / max) * 100}%` }} />
                </div>
                <span className="w-28 shrink-0 text-end tabular-nums text-muted">{r.label}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
