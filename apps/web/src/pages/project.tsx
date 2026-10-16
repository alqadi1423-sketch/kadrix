import { can, type IssueFilter } from "@kadrix/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { FilterBar } from "../components/filter-bar";
import { CalendarTab } from "../components/planning/calendar";
import { CyclesTab } from "../components/planning/cycles";
import { MilestonesTab } from "../components/planning/milestones";
import { ReleasesTab } from "../components/planning/releases";
import { TimelineTab } from "../components/planning/timeline";
import { TemplatesTab } from "../components/templates";
import { IssueBoard } from "../components/issue-board";
import { IssueList } from "../components/issue-list";
import { keys, useIssues, useLabels, useMembers, useProject, useWorkspace } from "../lib/hooks";
import { useWorkspaceUi } from "../layout";
import { Button, Empty } from "../ui";

type Layout = "list" | "board";
type Tab = "issues" | "cycles" | "milestones" | "timeline" | "calendar" | "releases" | "templates";
const TABS: Tab[] = ["issues", "cycles", "milestones", "timeline", "calendar", "releases", "templates"];

/** Remembers the last layout per project in this browser. */
function useLayoutPref(projectId: string): [Layout, (l: Layout) => void] {
  const k = `kadrix.layout.${projectId}`;
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return (localStorage.getItem(k) as Layout) || "list";
    } catch {
      return "list";
    }
  });
  return [
    layout,
    (l) => {
      setLayout(l);
      try {
        localStorage.setItem(k, l);
      } catch {
        // ignore
      }
    },
  ];
}

export function ProjectPage() {
  const { slug, projectId } = useParams({ strict: false }) as { slug: string; projectId: string };
  const { t } = useTranslation();
  const ui = useWorkspaceUi();
  const qc = useQueryClient();
  const ws = useWorkspace(slug);
  const project = useProject(slug, projectId);
  const labels = useLabels(slug);
  const members = useMembers(slug);
  const [layout, setLayout] = useLayoutPref(projectId);
  const [filter, setFilter] = useState<IssueFilter>({});
  const [tab, setTab] = useState<Tab>("issues");
  useEffect(() => {
    setFilter({});
    setTab("issues");
  }, [projectId]);
  const issues = useIssues(slug, { ...filter, projectId, ...(layout === "board" ? { includeClosed: true } : {}) });
  const role = ws.data?.workspace.role;

  const saveView = useMutation({
    mutationFn: (name: string) =>
      api.createView(slug, { name, layout, filter: { ...filter, projectId }, shared: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.views(slug) }),
  });

  if (!project.data) return <p className="text-muted">{t("common.loading")}</p>;
  const { states } = project.data;
  const p = project.data.project;
  // On the board, closed columns only show recent work to keep them short.
  const boardIssues = (issues.data ?? []).filter(
    (i) => !i.completedAt || Date.now() - new Date(i.completedAt).getTime() < 14 * 864e5 || filter.includeClosed,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded bg-paper px-1.5 text-sm text-muted" dir="ltr">
          {p.key}
        </span>
        <h1 className="text-2xl font-semibold" dir="auto">
          {p.name}
        </h1>
        <span className="flex-1" />
        {tab === "issues" && <div role="tablist" className="flex rounded-[var(--radius-control)] border border-line p-0.5 text-sm">
          {(["list", "board"] as const).map((l) => (
            <button
              key={l}
              role="tab"
              aria-selected={layout === l}
              onClick={() => setLayout(l)}
              className={`rounded px-3 py-1 ${layout === l ? "bg-petrol text-white dark:text-ink" : "text-muted"}`}
            >
              {t(`issues.${l}`)}
            </button>
          ))}
        </div>}
        {can(role, "issue.create") && <Button onClick={() => ui.newIssue({ projectId })}>{t("issues.newIssue")}</Button>}
      </div>
      <nav role="tablist" aria-label={p.name} className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={tab === x}
            onClick={() => setTab(x)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === x ? "border-petrol font-medium text-ink" : "border-transparent text-muted"}`}
          >
            {t(`projectTabs.${x}`)}
          </button>
        ))}
      </nav>
      {tab === "cycles" && <CyclesTab slug={slug} projectId={projectId} canManage={can(role, "planning.manage")} />}
      {tab === "milestones" && <MilestonesTab slug={slug} projectId={projectId} canManage={can(role, "planning.manage")} />}
      {tab === "timeline" && <TimelineTab slug={slug} projectId={projectId} canEdit={can(role, "issue.update")} />}
      {tab === "calendar" && <CalendarTab slug={slug} projectId={projectId} />}
      {tab === "releases" && <ReleasesTab slug={slug} projectId={projectId} canManage={can(role, "planning.manage")} />}
      {tab === "templates" && <TemplatesTab slug={slug} projectId={projectId} canManage={can(role, "template.manage")} />}
      {tab === "issues" && <>
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar filter={filter} onChange={setFilter} members={members.data ?? []} labels={labels.data ?? []} />
        {can(role, "view.manage") && (
          <Button
            variant="quiet"
            onClick={() => {
              const name = window.prompt(t("views.name"));
              if (name?.trim()) saveView.mutate(name.trim());
            }}
          >
            {t("views.save")}
          </Button>
        )}
      </div>
      {issues.isLoading ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : layout === "board" ? (
        <IssueBoard
          slug={slug}
          issues={boardIssues}
          states={states}
          labels={labels.data ?? []}
          wipLimits={Object.fromEntries(states.filter((s) => s.wipLimit != null).map((s) => [s.id, s.wipLimit!]))}
        />
      ) : issues.data?.length ? (
        <IssueList
          slug={slug}
          issues={issues.data}
          states={states}
          labels={labels.data ?? []}
          members={members.data ?? []}
          canEdit={can(role, "issue.update")}
        />
      ) : (
        <Empty>{t("issues.empty")}</Empty>
      )}
      </>}
    </div>
  );
}
