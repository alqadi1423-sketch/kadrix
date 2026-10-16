import { HEALTH, can } from "@kadrix/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type Initiative, type StatusUpdate } from "../api";
import { Markdown } from "../components/markdown";
import { useProjects, useWorkspace } from "../lib/hooks";
import { Button, Dialog, Empty, ErrorText, Field, Select } from "../ui";

/** Health is shown with a shape and a word, never colour alone. */
export function HealthBadge({ health }: { health: StatusUpdate["health"] | null }) {
  const { t } = useTranslation();
  const style = {
    onTrack: { cls: "bg-[#2e8b57]/15 text-ink", mark: "●" },
    atRisk: { cls: "bg-signal/20 text-ink", mark: "▲" },
    offTrack: { cls: "bg-danger/15 text-ink", mark: "■" },
  } as const;
  if (!health) return <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{t("health.unknown")}</span>;
  const s = style[health];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${s.cls}`}>
      <span aria-hidden>{s.mark}</span>
      {t(`health.${health}`)}
    </span>
  );
}

export function InitiativesPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { t } = useTranslation();
  const ws = useWorkspace(slug);
  const projects = useProjects(slug);
  const list = useQuery({ queryKey: ["ws", slug, "initiative"], queryFn: () => api.initiatives(slug) });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const canManage = can(ws.data?.workspace.role, "planning.manage");
  const items = list.data?.initiatives ?? [];
  const names = new Map((projects.data ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("initiatives.title")}</h1>
        {canManage && <Button onClick={() => setCreating(true)}>{t("initiatives.create")}</Button>}
      </div>
      {list.isSuccess && items.length === 0 && <Empty>{t("initiatives.empty")}</Empty>}
      <ul className="space-y-3">
        {items.map((i) => {
          const pct = i.total ? Math.round((i.done / i.total) * 100) : 0;
          const open = openId === i.id;
          return (
            <li key={i.id} className="rounded-[var(--radius-panel)] border border-line bg-surface">
              <button className="w-full space-y-2 p-4 text-start" aria-expanded={open} onClick={() => setOpenId(open ? null : i.id)}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-base font-semibold" dir="auto">
                    {i.name}
                  </span>
                  <HealthBadge health={i.health} />
                  {i.targetDate && (
                    <span className="text-sm text-muted tabular-nums" dir="ltr">
                      {i.targetDate}
                    </span>
                  )}
                  <span className="ms-auto text-sm text-muted tabular-nums">{pct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden>
                  <div className="h-full rounded-full bg-petrol" style={{ inlineSize: `${pct}%` }} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {i.projectIds.map((p) => (
                    <span key={p} className="rounded bg-paper px-2 py-0.5 text-xs text-muted">
                      {names.get(p)}
                    </span>
                  ))}
                </div>
              </button>
              {open && <InitiativeDetail slug={slug} initiative={i} canManage={canManage} />}
            </li>
          );
        })}
      </ul>
      <CreateInitiative slug={slug} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function InitiativeDetail({ slug, initiative, canManage }: { slug: string; initiative: Initiative; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const key = ["ws", slug, "initiative", initiative.id, "updates"];
  const updates = useQuery({ queryKey: key, queryFn: () => api.updates(slug, { initiativeId: initiative.id }) });
  const [body, setBody] = useState("");
  const post = useMutation({
    mutationFn: (health: StatusUpdate["health"]) => api.postUpdate(slug, { initiativeId: initiative.id, health, body }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["ws", slug, "initiative"] });
    },
  });
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  return (
    <div className="space-y-4 border-t border-line p-4">
      {initiative.description && <Markdown text={initiative.description} />}
      <h3 className="text-sm font-semibold">{t("initiatives.updates")}</h3>
      {canManage && (
        <form
          className="space-y-2"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const health = new FormData(e.currentTarget).get("health") as StatusUpdate["health"];
            if (body.trim()) post.mutate(health);
          }}
        >
          <textarea
            dir="auto"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("initiatives.updatePlaceholder")}
            className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2"
          />
          <div className="flex items-center gap-2">
            <Select name="health" defaultValue="onTrack" aria-label={t("health.label")}>
              {HEALTH.map((h) => (
                <option key={h} value={h}>
                  {t(`health.${h}`)}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={!body.trim() || post.isPending}>
              {t("initiatives.postUpdate")}
            </Button>
            <ErrorText error={post.error} />
          </div>
        </form>
      )}
      {updates.data?.updates.length === 0 && <p className="text-sm text-muted">{t("initiatives.noUpdates")}</p>}
      <ol className="space-y-3">
        {updates.data?.updates.map((u) => (
          <li key={u.id} className="border-s-2 border-line ps-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
              <HealthBadge health={u.health} />
              <span className="font-medium">{u.authorName}</span>
              <time className="text-muted" dateTime={u.createdAt}>
                {fmt.format(new Date(u.createdAt))}
              </time>
            </div>
            <Markdown text={u.body} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function CreateInitiative({ slug, open, onClose }: { slug: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const projects = useProjects(slug);
  const create = useMutation({
    mutationFn: (input: Parameters<typeof api.createInitiative>[1]) => api.createInitiative(slug, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ws", slug, "initiative"] });
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title={t("initiatives.create")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          create.mutate({
            name: String(f.get("name")),
            description: String(f.get("description") || "") || undefined,
            targetDate: String(f.get("targetDate") || "") || null,
            projectIds: f.getAll("projectIds").map(String),
          });
        }}
      >
        <Field label={t("initiatives.name")} name="name" required maxLength={80} dir="auto" />
        <label className="block">
          <span className="mb-1 block text-sm text-muted">{t("initiatives.description")}</span>
          <textarea name="description" rows={3} dir="auto" className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2" />
        </label>
        <Field label={t("initiatives.targetDate")} name="targetDate" type="date" dir="ltr" />
        <fieldset>
          <legend className="mb-1 text-sm text-muted">{t("initiatives.projects")}</legend>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {(projects.data ?? []).map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="projectIds" value={p.id} className="accent-petrol" />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="quiet" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {t("common.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
