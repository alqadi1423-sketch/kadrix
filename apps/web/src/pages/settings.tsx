import { ROLES, STATE_CATEGORIES, can, canManageRole, type Role, type StateCategory } from "@veloq/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, authClient, type AuditEntry } from "../api";
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
    { id: "general", label: t("workspaceSettings.general"), show: can(role, "workspace.update") },
    { id: "members", label: t("members.title"), show: can(role, "member.read") },
    { id: "labels", label: t("labels.title"), show: true },
    { id: "workflow", label: t("projects.workflow"), show: can(role, "workflow.manage") },
    ...extraTabs.map((x) => ({ id: x.id, label: x.label, show: x.show(role) })),
    { id: "audit", label: t("audit.title"), show: can(role, "audit.read") },
    { id: "preferences", label: t("preferences.title"), show: true },
  ];
  const visible = tabs.filter((x) => x.show);
  const [tab, setTab] = useState<Tab>("");
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
      {current === "general" && <General slug={slug} />}
      {current === "members" && <Members slug={slug} myRole={role} />}
      {current === "labels" && <Labels slug={slug} canManage={can(role, "label.manage")} />}
      {current === "workflow" && <Workflow slug={slug} />}
      {current === "audit" && <Audit slug={slug} />}
      {current === "preferences" && (
        <div className="space-y-6">
          <Preferences />
          <TwoFactorPanel />
        </div>
      )}
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
                <div className="flex items-center gap-2 font-medium">
                  {m.name}
                  {m.kind === "agent" && <span className="rounded bg-petrol/10 px-1.5 text-xs font-normal text-petrol">{t("agents.badge")}</span>}
                </div>
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
              {m.role === "guest" && can(myRole, "member.updateRole") && (
                <GuestProjects slug={slug} userId={m.userId} selected={m.projectIds ?? []} />
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

function General({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const ws = useWorkspace(slug);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (patch: { name?: string; weekendDays?: number[] }) => api.updateWorkspace(slug, patch),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: keys.workspace(slug) });
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
  if (!ws.data) return null;
  const weekend = ws.data.workspace.weekendDays;
  // Show the week starting on Sunday in Arabic and Monday in English.
  const order = i18n.language === "ar" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
  const dayName = (d: number) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 18 + d)));
  return (
    <Panel title={t("workspaceSettings.general")}>
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save.mutate({ name: String(f.get("name")), weekendDays: order.filter((d) => !f.getAll("work").includes(String(d))) });
        }}
        onChange={() => setSaved(false)}
      >
        <Field label={t("workspaces.name")} name="name" defaultValue={ws.data.workspace.name} required maxLength={80} dir="auto" />
        <fieldset>
          <legend className="mb-1 text-sm text-muted">{t("workspaceSettings.workingWeek")}</legend>
          <div className="flex flex-wrap gap-2">
            {order.map((d) => (
              <label key={d} className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2 py-1 text-sm">
                <input type="checkbox" name="work" value={d} defaultChecked={!weekend.includes(d)} className="accent-petrol" />
                {dayName(d)}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{t("workspaceSettings.weekendHint")}</p>
        </fieldset>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {t("common.save")}
          </Button>
          {saved && <span role="status" className="text-sm text-muted">{t("workspaceSettings.saved")}</span>}
          <ErrorText error={save.error} />
        </div>
      </form>
    </Panel>
  );
}

function GuestProjects({ slug, userId, selected }: { slug: string; userId: string; selected: string[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const projects = useProjects(slug);
  const save = useMutation({
    mutationFn: (ids: string[]) => api.setGuestProjects(slug, userId, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(slug) }),
  });
  const names = (projects.data ?? []).filter((p) => selected.includes(p.id)).map((p) => p.name);
  return (
    <details className="basis-full">
      <summary className="cursor-pointer text-sm text-petrol">
        {t("guests.projects")}: {names.length ? names.join("، ") : t("guests.none")}
      </summary>
      <div className="mt-2 flex flex-wrap gap-2">
        {(projects.data ?? []).map((p) => (
          <label key={p.id} className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-sm">
            <input
              type="checkbox"
              className="accent-petrol"
              checked={selected.includes(p.id)}
              onChange={(e) => save.mutate(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))}
            />
            {p.name}
          </label>
        ))}
      </div>
      <ErrorText error={save.error} />
    </details>
  );
}

function TwoFactorPanel() {
  const { t } = useTranslation();
  const session = authClient.useSession();
  const on = !!(session.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled;
  const [setup, setSetup] = useState<{ uri: string; secret: string; codes: string[]; qr: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(password: string) {
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (res.error || !res.data || !("totpURI" in res.data)) return setError(t("auth.badCredentials"));
    const uri = res.data.totpURI;
    const { toDataURL } = await import("qrcode");
    setSetup({ uri, secret: new URL(uri).searchParams.get("secret") ?? "", codes: res.data.backupCodes, qr: await toDataURL(uri, { margin: 1, width: 192 }) });
  }
  async function verify(code: string) {
    setBusy(true);
    const res = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (res.error) return setError(t("twoFactor.wrongCode"));
    setSetup(null);
    void session.refetch();
  }
  async function stop(password: string) {
    setBusy(true);
    const res = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (res.error) return setError(t("auth.badCredentials"));
    void session.refetch();
  }

  return (
    <Panel title={t("twoFactor.title")} action={<span className={`text-sm ${on ? "text-[#2e8b57]" : "text-muted"}`}>{on ? t("twoFactor.on") : t("twoFactor.off")}</span>}>
      <p className="mb-4 text-sm text-muted">{t("twoFactor.intro")}</p>
      {setup ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(String(new FormData(e.currentTarget).get("code")).replace(/\s/g, ""));
          }}
        >
          <p className="text-sm">{t("twoFactor.scan")}</p>
          <img src={setup.qr} alt="" width={192} height={192} className="rounded bg-white p-1" />
          <div>
            <div className="text-xs text-muted">{t("twoFactor.secret")}</div>
            <code dir="ltr" className="break-all text-sm">
              {setup.secret}
            </code>
          </div>
          <div>
            <div className="text-sm font-medium">{t("twoFactor.backupCodes")}</div>
            <p className="text-xs text-muted">{t("twoFactor.backupHint")}</p>
            <ul dir="ltr" className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
              {setup.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="flex items-end gap-2">
            <Field label={t("twoFactor.code")} name="code" required dir="ltr" inputMode="numeric" autoComplete="one-time-code" />
            <Button type="submit" disabled={busy}>
              {t("twoFactor.verify")}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const pw = String(new FormData(e.currentTarget).get("password"));
            void (on ? stop(pw) : start(pw));
          }}
        >
          <Field label={t("twoFactor.password")} name="password" type="password" required autoComplete="current-password" dir="auto" />
          <Button type="submit" variant={on ? "danger" : "primary"} disabled={busy}>
            {on ? t("twoFactor.disable") : t("twoFactor.enable")}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Panel>
  );
}

/** Personal settings, available to everyone. */
export function Preferences() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.preferences });
  const save = useMutation({
    mutationFn: (patch: { emailDigest?: boolean }) => api.setPreferences(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preferences"] }),
  });
  if (!prefs.data) return null;
  return (
    <Panel title={t("preferences.title")}>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-petrol"
          checked={prefs.data.preferences.emailDigest}
          onChange={(e) => save.mutate({ emailDigest: e.target.checked })}
        />
        {t("preferences.emailDigest")}
      </label>
    </Panel>
  );
}
