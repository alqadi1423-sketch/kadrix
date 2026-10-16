import { can } from "@veloq/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type PageSummary } from "../api";
import { DocEditor } from "../components/doc-editor";
import { useMe, useProjects, useWorkspace } from "../lib/hooks";
import { Button, Empty, Select } from "../ui";

/** Docs: a tree of pages per project (and workspace-wide), with a live editor. */
export function DocsPage() {
  const { slug, pageId } = useParams({ strict: false }) as { slug: string; pageId?: string };
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ws = useWorkspace(slug);
  const projects = useProjects(slug);
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["ws", slug, "page", q], queryFn: () => api.pages(slug, q || undefined) });
  const [scope, setScope] = useState<string>("");
  const canEdit = can(ws.data?.workspace.role, "issue.create");
  const pages = list.data?.pages ?? [];

  const create = useMutation({
    mutationFn: (input: { title: string; projectId: string | null; parentId?: string | null }) => api.createPage(slug, input),
    onSuccess: ({ page }) => {
      void qc.invalidateQueries({ queryKey: ["ws", slug, "page"] });
      void navigate({ to: "/w/$slug/docs/$pageId", params: { slug, pageId: page.id } });
    },
  });

  const groups: { id: string | null; name: string }[] = [
    ...(ws.data?.workspace.role === "guest" ? [] : [{ id: null, name: t("docs.workspacePages") }]),
    ...(projects.data ?? []).map((p) => ({ id: p.id, name: p.name })),
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-3">
        <input
          type="search"
          dir="auto"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("docs.searchPages")}
          aria-label={t("docs.searchPages")}
          className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm"
        />
        {canEdit && (
          <div className="flex gap-2">
            <Select value={scope} onChange={(e) => setScope(e.target.value)} aria-label={t("issues.project")} className="min-w-0 flex-1">
              {groups.map((g) => (
                <option key={g.id ?? ""} value={g.id ?? ""}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Button onClick={() => create.mutate({ title: t("docs.untitled"), projectId: scope || null })}>{t("docs.newPage")}</Button>
          </div>
        )}
        <nav aria-label={t("docs.title")} className="space-y-4">
          {groups.map((g) => {
            const inGroup = pages.filter((p) => p.projectId === g.id);
            if (!inGroup.length) return null;
            return (
              <section key={g.id ?? "ws"}>
                <h3 className="mb-1 px-2 text-xs text-muted">{g.name}</h3>
                <Tree slug={slug} pages={inGroup} parentId={null} active={pageId} flat={!!q} />
              </section>
            );
          })}
        </nav>
        {list.isSuccess && pages.length === 0 && <p className="px-2 text-sm text-muted">{t("docs.empty")}</p>}
      </aside>
      <div className="min-w-0">
        {pageId ? (
          <PageView key={pageId} slug={slug} pageId={pageId} canEdit={canEdit} onCreateChild={(p) => create.mutate({ title: t("docs.untitled"), projectId: p.projectId, parentId: p.id })} />
        ) : (
          <Empty>{t("docs.empty")}</Empty>
        )}
      </div>
    </div>
  );
}

function Tree({ slug, pages, parentId, active, flat }: { slug: string; pages: PageSummary[]; parentId: string | null; active?: string; flat: boolean }) {
  const { t } = useTranslation();
  const ids = new Set(pages.map((p) => p.id));
  // Pages whose parent is filtered out still show at the top level.
  const level = flat ? pages : pages.filter((p) => (parentId === null ? !p.parentId || !ids.has(p.parentId) : p.parentId === parentId));
  if (!level.length) return null;
  return (
    <ul className={parentId ? "ms-3 border-s border-line ps-2" : ""}>
      {level.map((p) => (
        <li key={p.id}>
          <Link
            to="/w/$slug/docs/$pageId"
            params={{ slug, pageId: p.id }}
            className={`block truncate rounded-[var(--radius-control)] px-2 py-1 text-sm no-underline hover:bg-paper ${active === p.id ? "bg-paper font-medium text-ink" : "text-ink"}`}
            dir="auto"
          >
            {p.title || t("docs.untitled")}
          </Link>
          {!flat && <Tree slug={slug} pages={pages} parentId={p.id} active={active} flat={false} />}
        </li>
      ))}
    </ul>
  );
}

function PageView({
  slug,
  pageId,
  canEdit,
  onCreateChild,
}: {
  slug: string;
  pageId: string;
  canEdit: boolean;
  onCreateChild: (p: PageSummary) => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useMe();
  const data = useQuery({ queryKey: ["ws", slug, "page", "one", pageId], queryFn: () => api.page(slug, pageId) });
  const [title, setTitle] = useState("");
  useEffect(() => setTitle(data.data?.page.title ?? ""), [data.data?.page.title]);
  const rename = useMutation({
    mutationFn: (v: string) => api.updatePage(slug, pageId, { title: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", slug, "page"] }),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePage(slug, pageId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ws", slug, "page"] });
      void navigate({ to: "/w/$slug/docs", params: { slug } });
    },
  });
  if (!data.data || !me.data) return <p className="text-muted">{t("common.loading")}</p>;
  const p = data.data.page;
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <input
        dir="auto"
        value={title}
        readOnly={!canEdit}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== p.title && rename.mutate(title.trim())}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label={t("issues.title")}
        className="w-full border-0 bg-transparent text-3xl font-semibold outline-none"
      />
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>
          {p.updatedByName ? `${p.updatedByName} · ` : ""}
          {fmt.format(new Date(p.updatedAt))}
        </span>
        {canEdit && (
          <>
            <button className="text-petrol" onClick={() => onCreateChild(p)}>
              {t("docs.addSubpage")}
            </button>
            <button className="text-danger" onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate()}>
              {t("docs.deletePage")}
            </button>
          </>
        )}
      </div>
      <DocEditor slug={slug} pageId={pageId} userName={me.data.user.name} readOnly={!canEdit} />
      {data.data.issues.length > 0 && (
        <section className="border-t border-line pt-4">
          <h2 className="mb-2 text-sm font-semibold">{t("docs.linkedIssues")}</h2>
          <ul className="space-y-1 text-sm">
            {data.data.issues.map((i) => (
              <li key={i.id}>
                <Link to="/w/$slug/i/$key" params={{ slug, key: i.key }} dir="auto">
                  <span dir="ltr" className="text-muted">
                    {i.key}
                  </span>{" "}
                  {i.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
