import {
  AUTOMATION_TRIGGERS,
  CONDITION_FIELDS,
  CONDITION_OPS,
  CSV_PRESETS,
  FIELD_KINDS,
  ISSUE_TYPES,
  PRIORITY_KEYS,
  STATE_CATEGORIES,
  type AutomationAction,
  type Condition,
  type CsvMapping,
  type FieldKind,
} from "@kadrix/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type AutomationRuleRow, type ImportInput } from "../api";
import { useLabels, useMembers, useProject, useProjects } from "../lib/hooks";
import { Button, ErrorText, Field, Panel, Select } from "../ui";
import { useFields } from "./extend";

const slugId = (name: string, i: number) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || `o${i}`;

/* ------------------------------- fields ------------------------------ */

export function FieldsSettings({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fields = useFields(slug);
  const projects = useProjects(slug);
  const [kind, setKind] = useState<FieldKind>("text");
  const refresh = () => qc.invalidateQueries({ queryKey: ["ws", slug, "field"] });
  const create = useMutation({ mutationFn: (input: Parameters<typeof api.createField>[1]) => api.createField(slug, input), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteField(slug, id), onSuccess: refresh });
  const choice = kind === "select" || kind === "multiSelect";
  const projectName = (id: string | null) => (id ? projects.data?.find((p) => p.id === id)?.name : t("fields.allProjects"));

  return (
    <Panel title={t("fields.title")}>
      {fields.data?.length ? (
        <ul className="mb-6 divide-y divide-line">
          {fields.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="font-medium" dir="auto">
                {f.name}
              </span>
              <span className="rounded bg-paper px-1.5 text-xs text-muted">{t(`fields.kinds.${f.kind}`)}</span>
              <span className="text-xs text-muted">{projectName(f.projectId)}</span>
              {f.options.length > 0 && (
                <span className="min-w-0 truncate text-xs text-muted" dir="auto">
                  {f.options.map((o) => o.name).join("، ")}
                </span>
              )}
              <Button variant="danger" className="ms-auto" onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(f.id)}>
                {t("common.delete")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-sm text-muted">{t("fields.empty")}</p>
      )}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          const lines = String(f.get("options") ?? "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          create.mutate(
            {
              name: String(f.get("name")),
              kind,
              projectId: String(f.get("projectId")) || null,
              options: choice ? lines.map((name, i) => ({ id: `${slugId(name, i)}-${i}`, name })) : [],
            },
            { onSuccess: () => form.reset() },
          );
        }}
      >
        <Field label={t("fields.name")} name="name" required maxLength={60} dir="auto" />
        <label className="block">
          <span className="mb-1 block text-sm text-muted">{t("fields.kind")}</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as FieldKind)} className="w-full py-2">
            {FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`fields.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">{t("issues.project")}</span>
          <Select name="projectId" defaultValue="" className="w-full py-2">
            <option value="">{t("fields.allProjects")}</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        {choice && (
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm text-muted">{t("fields.options")}</span>
            <textarea name="options" required rows={4} dir="auto" className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm" />
            <span className="mt-1 block text-xs text-muted">{t("fields.optionsHint")}</span>
          </label>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {t("fields.add")}
          </Button>
          <ErrorText error={create.error} />
        </div>
      </form>
    </Panel>
  );
}

/* ----------------------------- automation ---------------------------- */

const ACTION_KINDS = ["setState", "setPriority", "assign", "addLabel", "removeLabel", "comment", "setField"] as const;

function defaultAction(kind: (typeof ACTION_KINDS)[number]): AutomationAction {
  switch (kind) {
    case "setState":
      return { kind, stateId: "" };
    case "setPriority":
      return { kind, priority: 2 };
    case "assign":
      return { kind, userId: null };
    case "addLabel":
    case "removeLabel":
      return { kind, labelId: "" };
    case "comment":
      return { kind, body: "" };
    case "setField":
      return { kind, fieldId: "", value: null };
  }
}

export function AutomationSettings({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["ws", slug, "automation"], queryFn: () => api.automations(slug), select: (d) => d.rules });
  const projects = useProjects(slug);
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ws", slug, "automation"] });
  const toggle = useMutation({ mutationFn: (r: AutomationRuleRow) => api.updateAutomation(slug, r.id, { active: !r.active }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteAutomation(slug, id), onSuccess: refresh });

  return (
    <Panel title={t("automation.title")} action={!open && <Button onClick={() => setOpen(true)}>{t("automation.add")}</Button>}>
      {open && <RuleEditor slug={slug} onDone={() => setOpen(false)} />}
      {rules.data?.length ? (
        <ul className="divide-y divide-line">
          {rules.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium" dir="auto">
                  {r.name}
                </div>
                <div className="text-xs text-muted">
                  {t(`automation.triggers.${r.trigger}`)} · {r.projectId ? projects.data?.find((p) => p.id === r.projectId)?.name : t("automation.allProjects")} ·{" "}
                  {t("automation.runs", { count: r.runCount })}
                </div>
                {r.lastError && <div className="text-xs text-danger">{t("automation.lastError", { error: t(`errors.${r.lastError}`, { defaultValue: r.lastError }) })}</div>}
              </div>
              <Button variant="quiet" onClick={() => toggle.mutate(r)}>
                {r.active ? t("automation.pause") : t("automation.resume")}
              </Button>
              <Button variant="danger" onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(r.id)}>
                {t("common.delete")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        !open && <p className="text-sm text-muted">{t("automation.empty")}</p>
      )}
    </Panel>
  );
}

function RuleEditor({ slug, onDone }: { slug: string; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const projects = useProjects(slug);
  const members = useMembers(slug);
  const labels = useLabels(slug);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [trigger, setTrigger] = useState<(typeof AUTOMATION_TRIGGERS)[number]>("stateChanged");
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [actions, setActions] = useState<AutomationAction[]>([defaultAction("addLabel")]);
  const project = useProject(slug, projectId);
  const fields = useFields(slug, projectId || undefined);
  const states = project.data?.states ?? [];
  const create = useMutation({
    mutationFn: () => api.createAutomation(slug, { name, projectId: projectId || null, trigger, conditions, actions, active: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ws", slug, "automation"] });
      onDone();
    },
  });
  const setCond = (i: number, c: Partial<Condition>) => setConditions(conditions.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const setAct = (i: number, a: AutomationAction) => setActions(actions.map((x, j) => (j === i ? a : x)));

  const valueInput = (c: Condition, i: number) => {
    const common = { "aria-label": t(`automation.conditionFields.${c.field}`), className: "min-w-0 flex-1" };
    switch (c.field) {
      case "stateCategory":
        return (
          <Select {...common} value={String(c.value ?? "")} onChange={(e) => setCond(i, { value: e.target.value })}>
            {STATE_CATEGORIES.map((s) => (
              <option key={s} value={s}>
                {t(`stateCategories.${s}`)}
              </option>
            ))}
          </Select>
        );
      case "stateId":
        return (
          <Select {...common} value={String(c.value ?? "")} onChange={(e) => setCond(i, { value: e.target.value })}>
            <option value="" />
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        );
      case "priority":
        return (
          <Select {...common} value={String(c.value ?? 0)} onChange={(e) => setCond(i, { value: Number(e.target.value) })}>
            {PRIORITY_KEYS.map((k, n) => (
              <option key={k} value={n}>
                {t(`priority.${k}`)}
              </option>
            ))}
          </Select>
        );
      case "type":
        return (
          <Select {...common} value={String(c.value ?? "")} onChange={(e) => setCond(i, { value: e.target.value })}>
            {ISSUE_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`issueTypes.${k}`)}
              </option>
            ))}
          </Select>
        );
      case "labelId":
        return (
          <Select {...common} value={String(c.value ?? "")} onChange={(e) => setCond(i, { value: e.target.value })}>
            <option value="" />
            {(labels.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        );
      case "assigneeId":
        return (
          <Select {...common} value={String(c.value ?? "")} onChange={(e) => setCond(i, { value: e.target.value || null })}>
            <option value="">{t("issues.unassigned")}</option>
            {(members.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        );
      default:
        return <input {...common} dir="auto" value={String(c.value ?? "")} onChange={(e) => setCond(i, { value: e.target.value })} className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm" />;
    }
  };

  const actionInput = (a: AutomationAction, i: number) => {
    const cls = "min-w-0 flex-1";
    switch (a.kind) {
      case "setState":
        return (
          <Select className={cls} aria-label={t("automation.actions.setState")} value={a.stateId} onChange={(e) => setAct(i, { ...a, stateId: e.target.value })} disabled={!projectId}>
            <option value="">{projectId ? "" : t("automation.needsProject")}</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        );
      case "setPriority":
        return (
          <Select className={cls} aria-label={t("automation.actions.setPriority")} value={a.priority} onChange={(e) => setAct(i, { ...a, priority: Number(e.target.value) })}>
            {PRIORITY_KEYS.map((k, n) => (
              <option key={k} value={n}>
                {t(`priority.${k}`)}
              </option>
            ))}
          </Select>
        );
      case "assign":
        return (
          <Select className={cls} aria-label={t("automation.actions.assign")} value={a.userId ?? ""} onChange={(e) => setAct(i, { ...a, userId: e.target.value || null })}>
            <option value="">{t("issues.unassigned")}</option>
            {(members.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        );
      case "addLabel":
      case "removeLabel":
        return (
          <Select className={cls} aria-label={t(`automation.actions.${a.kind}`)} value={a.labelId} onChange={(e) => setAct(i, { ...a, labelId: e.target.value })}>
            <option value="" />
            {(labels.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        );
      case "comment":
        return (
          <input
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm"
            aria-label={t("automation.actions.comment")}
            dir="auto"
            value={a.body}
            maxLength={5000}
            onChange={(e) => setAct(i, { ...a, body: e.target.value })}
          />
        );
      case "setField": {
        const f = fields.data?.find((x) => x.id === a.fieldId);
        return (
          <div className="flex min-w-0 flex-1 gap-2">
            <Select className="min-w-0 flex-1" aria-label={t("automation.actions.setField")} value={a.fieldId} onChange={(e) => setAct(i, { ...a, fieldId: e.target.value, value: null })}>
              <option value="" />
              {(fields.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            {f && (f.kind === "select" ? (
              <Select className="min-w-0 flex-1" aria-label={f.name} value={String(a.value ?? "")} onChange={(e) => setAct(i, { ...a, value: e.target.value || null })}>
                <option value="">{t("fields.none")}</option>
                {f.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            ) : f.kind === "checkbox" ? (
              <input type="checkbox" className="accent-petrol" aria-label={f.name} checked={a.value === true} onChange={(e) => setAct(i, { ...a, value: e.target.checked || null })} />
            ) : (
              <input
                className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm"
                aria-label={f.name}
                dir="auto"
                type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
                value={String(a.value ?? "")}
                onChange={(e) => setAct(i, { ...a, value: e.target.value === "" ? null : f.kind === "number" ? Number(e.target.value) : e.target.value })}
              />
            ))}
          </div>
        );
      }
    }
  };

  return (
    <form
      className="mb-6 space-y-4 rounded-[var(--radius-panel)] border border-line bg-paper p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("automation.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} dir="auto" />
        <label className="block">
          <span className="mb-1 block text-sm text-muted">{t("automation.scope")}</span>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full py-2">
            <option value="">{t("automation.allProjects")}</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">{t("automation.when")}</legend>
        <Select value={trigger} onChange={(e) => setTrigger(e.target.value as typeof trigger)} aria-label={t("automation.when")}>
          {AUTOMATION_TRIGGERS.map((x) => (
            <option key={x} value={x}>
              {t(`automation.triggers.${x}`)}
            </option>
          ))}
        </Select>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">{t("automation.if")}</legend>
        {conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select value={c.field} onChange={(e) => setCond(i, { field: e.target.value as Condition["field"], value: null })} aria-label={t("automation.if")}>
              {CONDITION_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {t(`automation.conditionFields.${f}`)}
                </option>
              ))}
            </Select>
            <Select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Condition["op"] })} aria-label={t("automation.ops.is")}>
              {CONDITION_OPS.filter((o) => o !== "contains" || c.field === "title").map((o) => (
                <option key={o} value={o}>
                  {t(`automation.ops.${o}`)}
                </option>
              ))}
            </Select>
            {valueInput(c, i)}
            <Button type="button" variant="quiet" onClick={() => setConditions(conditions.filter((_, j) => j !== i))}>
              {t("automation.remove")}
            </Button>
          </div>
        ))}
        <Button type="button" variant="quiet" onClick={() => setConditions([...conditions, { field: "stateCategory", op: "is", value: "completed" }])}>
          {t("automation.addCondition")}
        </Button>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">{t("automation.then")}</legend>
        {actions.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select value={a.kind} onChange={(e) => setAct(i, defaultAction(e.target.value as (typeof ACTION_KINDS)[number]))} aria-label={t("automation.then")}>
              {ACTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`automation.actions.${k}`)}
                </option>
              ))}
            </Select>
            {actionInput(a, i)}
            {actions.length > 1 && (
              <Button type="button" variant="quiet" onClick={() => setActions(actions.filter((_, j) => j !== i))}>
                {t("automation.remove")}
              </Button>
            )}
          </div>
        ))}
        {actions.length < 10 && (
          <Button type="button" variant="quiet" onClick={() => setActions([...actions, defaultAction("comment")])}>
            {t("automation.addAction")}
          </Button>
        )}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {t("common.save")}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
      <ErrorText error={create.error} />
    </form>
  );
}

/* ------------------------------- import ------------------------------ */

const MAP_KEYS = ["externalId", "title", "description", "state", "priority", "type", "labels", "assignee", "estimate", "dueDate", "createdAt", "parent"] as const;

export function ImportSettings({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const projects = useProjects(slug);
  const [source, setSource] = useState<ImportInput["source"]>("jira");
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CsvMapping>({ title: "" });
  const run = useMutation({
    mutationFn: (input: ImportInput) => api.runImport(slug, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", slug, "issues"] }),
  });
  const n = new Intl.NumberFormat(i18n.language);

  async function readFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    const { headers: h } = await api.importPreview(slug, text);
    setHeaders(h);
    // Guess the mapping from the Jira and Linear header names.
    const guess: CsvMapping = { title: "" };
    for (const k of MAP_KEYS) {
      const want = [CSV_PRESETS.jira[k], CSV_PRESETS.linear[k], k].filter(Boolean).map((x) => String(x).toLowerCase());
      const hit = h.find((x) => want.includes(x.toLowerCase()));
      if (hit) guess[k] = hit;
    }
    setMapping(guess);
  }

  return (
    <Panel title={t("importer.title")}>
      <p className="mb-4 text-sm text-muted">{t("importer.intro")}</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const projectId = String(f.get("projectId"));
          if (source === "github") run.mutate({ source, projectId, repo: String(f.get("repo")).trim(), token: String(f.get("token") || "") || undefined });
          else if (source === "csv") run.mutate({ source, projectId, csv, mapping });
          else run.mutate({ source, projectId, csv });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t("importer.source")}</span>
            <Select value={source} onChange={(e) => setSource(e.target.value as ImportInput["source"])} className="w-full py-2">
              {(["jira", "linear", "github", "csv"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`importer.sources.${s}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t("importer.project")}</span>
            <Select name="projectId" required className="w-full py-2">
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {source === "github" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("importer.repo")} name="repo" required pattern="[\w.\-]+/[\w.\-]+" dir="ltr" placeholder="owner/repo" />
            <Field label={t("importer.token")} name="token" type="password" dir="ltr" autoComplete="off" hint={t("importer.tokenHint")} />
          </div>
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t("importer.file")}</span>
            <input type="file" accept=".csv,text/csv" required onChange={(e) => void readFile(e.target.files?.[0])} className="block text-sm" />
          </label>
        )}
        {source === "csv" && headers.length > 0 && (
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-semibold">{t("importer.mapping")}</legend>
            {MAP_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 text-muted">{t(`importer.field.${k}`)}</span>
                <Select
                  className="min-w-0 flex-1"
                  required={k === "title"}
                  value={mapping[k] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [k]: e.target.value || undefined, title: k === "title" ? e.target.value : mapping.title })}
                >
                  <option value="">{t("importer.ignore")}</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </fieldset>
        )}
        <Button type="submit" disabled={run.isPending || (source !== "github" && !csv)}>
          {run.isPending ? t("importer.running") : t("importer.run")}
        </Button>
        <ErrorText error={run.error} />
        {run.data && (
          <p role="status" className="text-sm text-[#2e8b57]">
            {t("importer.done", { created: n.format(run.data.stats.created), updated: n.format(run.data.stats.updated), skipped: n.format(run.data.stats.skipped) })}
          </p>
        )}
      </form>
    </Panel>
  );
}

