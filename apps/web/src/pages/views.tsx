import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type SavedView } from "../api";
import { IssueBoard } from "../components/issue-board";
import { IssueList } from "../components/issue-list";
import { keys, useIssues, useLabels, useMe, useMembers, useProject } from "../lib/hooks";
import { Button, Empty } from "../ui";

export function ViewsPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const views = useQuery({ queryKey: keys.views(slug), queryFn: () => api.views(slug) });
  const [openId, setOpenId] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteView(slug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.views(slug) }),
  });
  const list = views.data?.views ?? [];
  const open = list.find((v) => v.id === openId);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("views.title")}</h1>
      {views.isSuccess && list.length === 0 && <Empty>{t("views.empty")}</Empty>}
      <div className="flex flex-wrap gap-2">
        {list.map((v) => (
          <span key={v.id} className="flex items-center rounded-full border border-line bg-surface">
            <button
              onClick={() => setOpenId(v.id)}
              aria-pressed={openId === v.id}
              className={`rounded-full px-3 py-1 text-sm ${openId === v.id ? "bg-petrol text-white dark:text-ink" : ""}`}
            >
              {v.name}
            </button>
            {v.ownerId === me.data?.user.id && (
              <button className="px-2 text-muted hover:text-danger" aria-label={t("common.delete")} onClick={() => remove.mutate(v.id)}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {open && <ViewResults slug={slug} view={open} />}
      {list.length > 0 && !open && <Button variant="quiet" onClick={() => setOpenId(list[0]!.id)}>{list[0]!.name}</Button>}
    </div>
  );
}

function ViewResults({ slug, view }: { slug: string; view: SavedView }) {
  const { t } = useTranslation();
  const issues = useIssues(slug, view.layout === "board" ? { ...view.filter, includeClosed: true } : view.filter);
  const labels = useLabels(slug);
  const members = useMembers(slug);
  const project = useProject(slug, view.filter.projectId ?? "");
  if (issues.isLoading) return <p className="text-muted">{t("common.loading")}</p>;
  if (!issues.data?.length) return <Empty>{t("issues.empty")}</Empty>;
  if (view.layout === "board" && project.data) {
    return <IssueBoard slug={slug} issues={issues.data} states={project.data.states} labels={labels.data ?? []} />;
  }
  return (
    <IssueList
      slug={slug}
      issues={issues.data}
      states={project.data?.states}
      labels={labels.data ?? []}
      members={members.data ?? []}
      canEdit
    />
  );
}
