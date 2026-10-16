import { ROLES, STATE_CATEGORIES, can, canManageRole, type Role, type StateCategory } from "@veloq/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, type AuditEntry } from "../api";
import { Avatar, LabelChip, StateIcon } from "../components/icons";
import { keys, useLabels, useMembers, useProject, useProjects, useWorkspace } from "../lib/hooks";
import { Button, ErrorText, Field, Panel, Select } from "../ui";

type Tab = "members" | "labels" | "workflow" | "audit" | string;

/** Workspace settings. Extra tabs (integrations, tokens…) register below. */
export function SettingsPage({ extraTabs = [] }: { extraTabs?: { id: string; label: string; show: (r?: Role) => boolean; render: (slug: string) => ReactNode }[] }) {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { t } = useTranslation();
  const ws = useWorkspace(slug);
  const role = ws.data?.workspace.role;
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "members", label: t("members.title"), show: can(role, "member.read") },
    { id: "labels", label: t("labels.title"), show: true },
    { id: "workflow", label: t("projects.workflow"), show: can(role, "workflow.manage") },
    ...extraTabs.map((x) => ({ id: x.id, label: x.label, show: x.show(role) })),
    { id: "audit", label: t("audit.title"), show: can(role, "audit.read") },
  ];
  const visible = tabs.filter((x) => x.show);
  const [tab, setTab] = useState<Tab>("members");
  const current = visible.find((x) => x.id === tab)?.id ?? visible[0]?.id;

  if (!role) return <p className="text-muted">{t("common.loading")}</p>;
  const extra = extraTabs.find((x) => x.id === current);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("nav.settings")}</h1>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
        {visible.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={current === x.id}
            onClick={() => setTab(x.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${current === x.id ? "border-petrol font-medium text-ink" : "border-transparent text-muted"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {current === "members" && <Members slug={slug} myRole={role} />}
      {current === "labels" && <Labels slug={slug} canManage={can(role, "label.manage")} />}
      {current === "workflow" && <Workflow slug={slug} />}
      {current === "audit" && <Audit slug={slug} />}
      {extra?.render(slug)}
    </div>
  );
}

function Members({ slug, myRole }: { slug: string; myRole: Role }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const members = useMembers(slug);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.members(slug) });
    void qc.invalidateQueries({ queryKey: ["ws", slug, "audit"] });
  };
  const add = useMutation({ mutationFn: (input: { email: string; role: Role }) => api.addMember(slug, input), onSuccess: refresh });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: Role }) => api.setRole(slug, v.userId, v.role),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (userId: string) => api.removeMember(slug, userId), onSuccess: refresh });
  const grantable = ROLES.filter((r) => r !== "owner" && canManageRole(myRole, null, r));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    add.mutate({ email: String(f.get("email")), role: f.get("role") as Role }, { onSuccess: () => form.reset() });
  }

  return (
    <Panel title={t("members.title")}>
      <ul className="divide-y divide-line">
        {(members.data ?? []).map((m) => {
          const options = ROLES.filter((r) => r === m.role || canManageRole(myRole, m.role, r));
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={m.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{m.name}</div>
                <div className="text-sm text-muted" dir="ltr">
                  {m.email}
                </div>
              </div>
              {options.length > 1 ? (
                <Select aria-label={t("members.role")} value={m.role} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value as Role })}>
                  {options.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-sm text-muted">{t(`roles.${m.role}`)}</span>
              )}
              {canManageRole(myRole, m.role, "guest") && (
                <Button variant="danger" onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(m.userId)}>
                  {t("common.remove")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorText error={setRole.error ?? remove.error} />
      {can(myRole, "member.invite") && grantable.length > 0 && (
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <div className="min-w-56 flex-1">
            <Field label={t("members.email")} name="email" type="email" required dir="ltr" />
          </div>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t("members.role")}</span>
            <Select name="role" defaultValue={grantable.includes("member") ? "member" : grantable[0]} className="py-2">
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" disabled={add.isPending}>
            {t("members.add")}
          </Button>
          <div className="basis-full">
            <ErrorText error={add.error} />
          </div>
        </form>
      )}
    </Panel>
  );
}

const PALETTE = ["#0f6b73", "#2f7fd1", "#8e6bb8", "#d08a00", "#b42318", "#2e8b57", "#5b7176", "#c2417a"];

function Labels({ slug, canManage }: { slug: string; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const labels = useLabels(slug);
  const [color, setColor] = useState(PALETTE[0]!);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.labels(slug) });
  const create = useMutation({ mutationFn: (name: string) => api.createLabel(slug, { name, color }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteLabel(slug, id), onSuccess: refresh });
  return (
    <Panel title={t("labels.title")}>
      {labels.data?.length === 0 && <p className="text-muted">{t("labels.empty")}</p>}
      <ul className="flex flex-wrap gap-2">
        {(labels.data ?? []).map((l) => (
          <li key={l.id} className="flex items-center gap-1">
            <LabelChip name={l.name} color={l.color} />
            {canManage && (
              <button className="text-muted hover:text-danger" aria-label={`${t("common.delete")} ${l.name}`} onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(l.id)}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const name = String(new FormData(form).get("name")).trim();
            if (name) create.mutate(name, { onSuccess: () => form.reset() });
          }}
        >
          <div className="min-w-48 flex-1">
            <Field label={t("labels.name")} name="name" required maxLength={40} dir="auto" />
          </div>
          <fieldset className="flex gap-1" aria-label={t("projects.color")}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`size-6 rounded-full ${color === c ? "ring-2 ring-ink ring-offset-2" : ""}`}
                style={{ background: c }}
              />
            ))}
          </fieldset>
          <Button type="submit">{t("labels.create")}</Button>
          <div className="basis-full">
            <ErrorText error={create.error} />
          </div>
        </form>
      )}
    </Panel>
  );
}

function Workflow({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const projects = useProjects(slug);
  const [pid, setPid] = useState("");
  const id = pid || projects.data?.[0]?.id || "";
  return (
    <Panel
      title={t("projects.workflow")}
      action={
        <Select value={id} onChange={(e) => setPid(e.target.value)} aria-label={t("issues.project")}>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      }
    >
      {id ? <WorkflowEditor slug={slug} projectId={id} /> : <p className="text-muted">{t("projects.empty")}</p>}
    </Panel>
  );
}

function WorkflowEditor({ slug, projectId }: { slug: string; projectId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const project = useProject(slug, projectId);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.project(slug, projectId) });
  const create = useMutation({
    mutationFn: (input: { name: string; category: StateCategory; color: string }) => api.createState(slug, projectId, input),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) => api.updateState(slug, projectId, v.id, v.patch),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (v: { id: string; moveTo?: string }) => api.deleteState(slug, projectId, v.id, v.moveTo),
    onSuccess: refresh,
  });
  const states = project.data?.states ?? [];
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line">
        {states.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
            <StateIcon category={s.category} color={s.color} />
            <input
              defaultValue={s.name}
              key={s.name}
              dir="auto"
              aria-label={t("projects.stateName")}
              onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && update.mutate({ id: s.id, patch: { name: e.target.value.trim() } })}
              className="min-w-32 flex-1 rounded-[var(--radius-control)] border border-transparent bg-transparent px-2 py-1 hover:border-line focus:border-petrol"
            />
            <span className="text-sm text-muted">{t(`stateCategories.${s.category}`)}</span>
            <label className="flex items-center gap-1 text-xs text-muted">
              WIP
              <input
                type="number"
                min={1}
                defaultValue={s.wipLimit ?? ""}
                key={s.wipLimit ?? "x"}
                onBlur={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  if (v !== s.wipLimit) update.mutate({ id: s.id, patch: { wipLimit: v } });
                }}
                className="w-14 rounded border border-line bg-surface px-1 py-0.5"
              />
            </label>
            <button
              className="text-sm text-muted hover:text-danger"
              onClick={() => {
                const others = states.filter((x) => x.id !== s.id);
                const fallback = others.find((x) => x.category === s.category) ?? others[0];
                if (window.confirm(t("common.confirmDelete"))) remove.mutate({ id: s.id, moveTo: fallback?.id });
              }}
            >
              {t("common.delete")}
            </button>
          </li>
        ))}
      </ul>
      <ErrorText error={update.error ?? remove.error} />
      <form
        className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          create.mutate(
            { name: String(f.get("name")), category: f.get("category") as StateCategory, color: String(f.get("color")) },
            { onSuccess: () => form.reset() },
          );
        }}
      >
        <div className="min-w-40 flex-1">
          <Field label={t("projects.stateName")} name="name" required maxLength={40} dir="auto" />
        </div>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">{t("projects.category")}</span>
          <Select name="category" defaultValue="started" className="py-2">
            {STATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`stateCategories.${c}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">{t("projects.color")}</span>
          <input type="color" name="color" defaultValue="#2f7fd1" className="h-10 w-14 rounded border border-line bg-surface" />
        </label>
        <Button type="submit">{t("projects.addState")}</Button>
      </form>
    </div>
  );
}

function Audit({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const audit = useQuery({ queryKey: ["ws", slug, "audit"], queryFn: () => api.audit(slug) });
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  const describe = (e: AuditEntry) =>
    t(`audit.actions.${e.action}`, {
      actor: e.actorName ?? "?",
      target: String(e.data.targetName ?? e.data.name ?? e.data.provider ?? ""),
      role: e.data.role ? t(`roles.${String(e.data.role)}`) : "",
    });
  const entries = audit.data?.entries ?? [];
  return (
    <Panel title={t("audit.title")}>
      {audit.isSuccess && entries.length === 0 && <p className="text-muted">{t("audit.empty")}</p>}
      <ol className="space-y-3">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap justify-between gap-2 border-s-2 border-line ps-3">
            <span>{describe(e)}</span>
            <time className="text-sm text-muted" dateTime={e.createdAt}>
              {fmt.format(new Date(e.createdAt))}
            </time>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
