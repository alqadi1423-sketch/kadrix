import { ISSUE_TYPES, PRIORITY_KEYS, can, parseIssueKey } from "@veloq/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, type Issue, type Member, type Relation } from "../api";
import { DevSection } from "../components/dev";
import { Avatar, LabelChip, StateIcon } from "../components/icons";
import { IssueRow } from "../components/issue-row";
import { Markdown } from "../components/markdown";
import { MentionTextarea } from "../components/mention-input";
import { keys, useLabels, useMe, useMembers, useProject, useUpdateIssue, useWorkspace } from "../lib/hooks";
import { useWorkspaceUi } from "../layout";
import { Button, ErrorText, Select } from "../ui";

export function IssuePage() {
  const { slug, key } = useParams({ strict: false }) as { slug: string; key: string };
  const { t } = useTranslation();
  const byKey = useQuery({
    queryKey: ["ws", slug, "issues", "key", key],
    queryFn: () => api.issueByKey(slug, key),
    enabled: !!parseIssueKey(key),
  });
  const id = byKey.data?.issue.id;
  if (byKey.error) return <ErrorText error={byKey.error} />;
  if (!id) return <p className="text-muted">{t("common.loading")}</p>;
  return <IssueDetail slug={slug} id={id} />;
}

function IssueDetail({ slug, id }: { slug: string; id: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ui = useWorkspaceUi();
  const ws = useWorkspace(slug);
  const members = useMembers(slug);
  const labels = useLabels(slug);
  const detail = useQuery({ queryKey: keys.issue(slug, id), queryFn: () => api.issue(slug, id) });
  const issue = detail.data?.issue;
  const project = useProject(slug, issue?.projectId ?? "");
  const update = useUpdateIssue(slug);
  const role = ws.data?.workspace.role;
  const editable = can(role, "issue.update");

  const set = (patch: Record<string, unknown>) =>
    update.mutate({ id, patch }, { onSettled: () => qc.invalidateQueries({ queryKey: keys.issue(slug, id) }) });

  const del = useMutation({
    mutationFn: () => api.deleteIssue(slug, id),
    onSuccess: () => navigate({ to: "/w/$slug/p/$projectId", params: { slug, projectId: issue!.projectId } }),
  });
  const sub = useMutation({
    mutationFn: (on: boolean) => api.subscribe(slug, id, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.issue(slug, id) }),
  });

  if (!issue || !detail.data) return <p className="text-muted">{t("common.loading")}</p>;
  const states = project.data?.states ?? [];
  const m = members.data ?? [];

  return (
    <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_18rem]">
      <div className="min-w-0 space-y-6">
        <nav className="flex items-center gap-2 text-sm text-muted">
          <Link to="/w/$slug/p/$projectId" params={{ slug, projectId: issue.projectId }}>
            {project.data?.project.name}
          </Link>
          <span aria-hidden>/</span>
          <span dir="ltr">{issue.key}</span>
        </nav>
        <TitleEditor value={issue.title} editable={editable} onSave={(title) => set({ title })} />
        <DescriptionEditor
          value={issue.description ?? ""}
          editable={editable}
          members={m}
          onSave={(description) => set({ description })}
        />
        <SubIssues slug={slug} issue={issue} children={detail.data.children} labels={labels.data ?? []} onAdd={() => ui.newIssue({ projectId: issue.projectId, parentId: issue.id })} editable={editable} />
        <Relations slug={slug} issue={issue} relations={detail.data.relations} related={detail.data.related} editable={editable} />
        <DevSection slug={slug} issueId={id} issueKey={issue.key} />
        <MentionedInDocs slug={slug} issueId={id} />
        <Attachments slug={slug} id={id} editable={editable} />
        <Conversation slug={slug} id={id} members={m} canComment={can(role, "comment.create")} canModerate={can(role, "issue.delete")} />
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Prop label={t("issues.state")}>
          <div className="flex items-center gap-2">
            <StateIcon category={issue.stateCategory} color={issue.stateColor} />
            <Select disabled={!editable} value={issue.stateId} onChange={(e) => set({ stateId: e.target.value })} aria-label={t("issues.state")} className="flex-1">
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </Prop>
        <Prop label={t("priority.label")}>
          <Select disabled={!editable} value={issue.priority} onChange={(e) => set({ priority: Number(e.target.value) })} aria-label={t("priority.label")} className="w-full">
            {PRIORITY_KEYS.map((k, i) => (
              <option key={k} value={i}>
                {t(`priority.${k}`)}
              </option>
            ))}
          </Select>
        </Prop>
        <Prop label={t("issues.assignee")}>
          <div className="flex items-center gap-2">
            <Avatar name={issue.assigneeName} />
            <Select
              disabled={!editable}
              value={issue.assigneeId ?? ""}
              onChange={(e) => set({ assigneeId: e.target.value || null })}
              aria-label={t("issues.assignee")}
              className="flex-1"
            >
              <option value="">{t("issues.unassigned")}</option>
              {m.map((x) => (
                <option key={x.userId} value={x.userId}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
        </Prop>
        <Prop label={t("issueTypes.label")}>
          <Select disabled={!editable} value={issue.type} onChange={(e) => set({ type: e.target.value })} aria-label={t("issueTypes.label")} className="w-full">
            {ISSUE_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`issueTypes.${k}`)}
              </option>
            ))}
          </Select>
        </Prop>
        <PlanningProps slug={slug} projectId={issue.projectId} cycleId={issue.cycleId} milestoneId={issue.milestoneId} editable={editable} onChange={set} />
        <Prop label={t("issues.labels")}>
          <LabelPicker
            all={labels.data ?? []}
            selected={issue.labelIds}
            editable={editable}
            onChange={(labelIds) => set({ labelIds })}
          />
        </Prop>
        <div className="grid grid-cols-2 gap-3">
          <Prop label={t("issues.startDate")}>
            <DateInput disabled={!editable} value={issue.startDate} onChange={(startDate) => set({ startDate })} label={t("issues.startDate")} />
          </Prop>
          <Prop label={t("issues.dueDate")}>
            <DateInput disabled={!editable} value={issue.dueDate} onChange={(dueDate) => set({ dueDate })} label={t("issues.dueDate")} />
          </Prop>
        </div>
        <Prop label={t("issues.estimate")}>
          <input
            type="number"
            min={0}
            step="0.5"
            disabled={!editable}
            defaultValue={issue.estimate ?? ""}
            key={issue.estimate ?? "none"}
            onBlur={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              if (v !== issue.estimate) set({ estimate: v });
            }}
            aria-label={t("issues.estimate")}
            className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm"
          />
        </Prop>
        <ErrorText error={update.error} />
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="quiet" onClick={() => sub.mutate(!detail.data.subscribed)}>
            {detail.data.subscribed ? t("issues.unsubscribe") : t("issues.subscribe")}
          </Button>
          <CopyLink />
          {can(role, "issue.delete") && (
            <Button variant="danger" onClick={() => window.confirm(t("common.confirmDelete")) && del.mutate()}>
              {t("issues.deleteIssue")}
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{label}</div>
      {children}
    </div>
  );
}

function DateInput({ value, onChange, disabled, label }: { value: string | null; onChange: (v: string | null) => void; disabled: boolean; label: string }) {
  return (
    <input
      type="date"
      dir="ltr"
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={label}
      className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm"
    />
  );
}

function CopyLink() {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="quiet"
      onClick={() => {
        void navigator.clipboard?.writeText(window.location.href);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? t("common.copied") : t("issues.copyLink")}
    </Button>
  );
}

function TitleEditor({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      dir="auto"
      rows={1}
      readOnly={!editable}
      value={v}
      aria-label={t("issues.title")}
      onChange={(e) => setV(e.target.value.replace(/\n/g, ""))}
      onBlur={() => v.trim() && v !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
      className="field-sizing-content w-full resize-none border-0 bg-transparent text-2xl font-semibold outline-none"
    />
  );
}

function DescriptionEditor({
  value,
  editable,
  members,
  onSave,
}: {
  value: string;
  editable: boolean;
  members: Member[];
  onSave: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  if (editing) {
    return (
      <div className="space-y-2">
        <MentionTextarea value={draft} onChange={setDraft} members={members} rows={10} autoFocus placeholder={t("issues.descriptionPlaceholder")} />
        <div className="flex gap-2">
          <Button
            onClick={() => {
              if (draft !== value) onSave(draft);
              setEditing(false);
            }}
          >
            {t("common.save")}
          </Button>
          <Button variant="quiet" onClick={() => setEditing(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={() => editable && setEditing(true)}
      onKeyDown={(e) => editable && e.key === "Enter" && setEditing(true)}
      className={`min-h-16 rounded-[var(--radius-control)] ${editable ? "cursor-text hover:bg-paper" : ""} p-2`}
    >
      {value ? <Markdown text={value} members={members} /> : <span className="text-muted">{t("issues.descriptionPlaceholder")}</span>}
    </div>
  );
}

function LabelPicker({
  all,
  selected,
  editable,
  onChange,
}: {
  all: { id: string; name: string; color: string }[];
  selected: string[];
  editable: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const own = all.filter((l) => selected.includes(l.id));
  return (
    <details className="group">
      <summary className={`flex min-h-8 flex-wrap items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 py-1 ${editable ? "cursor-pointer" : "pointer-events-none"}`}>
        {own.length ? own.map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />) : <span className="text-sm text-muted">{t("common.none")}</span>}
      </summary>
      {editable && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface p-1">
          {all.length === 0 && <li className="px-2 py-1 text-sm text-muted">{t("labels.empty")}</li>}
          {all.map((l) => (
            <li key={l.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-paper">
                <input
                  type="checkbox"
                  className="accent-petrol"
                  checked={selected.includes(l.id)}
                  onChange={(e) => onChange(e.target.checked ? [...selected, l.id] : selected.filter((x) => x !== l.id))}
                />
                <span className="size-2 rounded-full" style={{ background: l.color }} />
                {l.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function SubIssues({
  slug,
  issue,
  children,
  labels,
  onAdd,
  editable,
}: {
  slug: string;
  issue: Issue;
  children: Issue[];
  labels: { id: string; name: string; color: string }[];
  onAdd: () => void;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const done = children.filter((c) => c.stateCategory === "completed").length;
  return (
    <section>
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {t("issues.subIssues")}
          {children.length > 0 && (
            <span className="ms-2 font-normal text-muted tabular-nums">
              {done}/{children.length}
            </span>
          )}
        </h2>
        {editable && (
          <Button variant="quiet" onClick={onAdd}>
            {t("issues.addSubIssue")}
          </Button>
        )}
      </header>
      {issue.parentId && <ParentLink slug={slug} parentId={issue.parentId} />}
      {children.length > 0 && (
        <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          {children.map((c) => (
            <IssueRow key={c.id} issue={c} slug={slug} labels={labels} />
          ))}
        </div>
      )}
    </section>
  );
}

function ParentLink({ slug, parentId }: { slug: string; parentId: string }) {
  const { t } = useTranslation();
  const p = useQuery({ queryKey: keys.issue(slug, parentId), queryFn: () => api.issue(slug, parentId) });
  if (!p.data) return null;
  return (
    <p className="mb-2 text-sm text-muted">
      {t("issues.parent")}:{" "}
      <Link to="/w/$slug/i/$key" params={{ slug, key: p.data.issue.key }} dir="auto">
        {p.data.issue.key} {p.data.issue.title}
      </Link>
    </p>
  );
}

function Relations({
  slug,
  issue,
  relations,
  related,
  editable,
}: {
  slug: string;
  issue: Issue;
  relations: Relation[];
  related: Issue[];
  editable: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<Relation["type"]>("relates");
  const [key, setKey] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: keys.issue(slug, issue.id) });
  const add = useMutation({
    mutationFn: async () => {
      const other = await api.issueByKey(slug, key.trim().toUpperCase());
      return api.addRelation(slug, issue.id, { type, relatedIssueId: other.issue.id });
    },
    onSuccess: () => {
      setAdding(false);
      setKey("");
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (rid: string) => api.deleteRelation(slug, rid), onSuccess: refresh });
  const byId = new Map(related.map((r) => [r.id, r]));
  const label = (r: Relation) => {
    const outgoing = r.issueId === issue.id;
    if (r.type === "relates") return t("issues.relationTypes.relates");
    if (r.type === "blocks") return t(outgoing ? "issues.relationTypes.blocks" : "issues.relationTypes.blockedBy");
    return t(outgoing ? "issues.relationTypes.duplicates" : "issues.relationTypes.duplicatedBy");
  };
  if (!relations.length && !editable) return null;
  return (
    <section>
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("issues.relations")}</h2>
        {editable && !adding && (
          <Button variant="quiet" onClick={() => setAdding(true)}>
            {t("issues.addRelation")}
          </Button>
        )}
      </header>
      {adding && (
        <form
          className="mb-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Select value={type} onChange={(e) => setType(e.target.value as Relation["type"])} aria-label={t("issues.relations")}>
            <option value="relates">{t("issues.relationTypes.relates")}</option>
            <option value="blocks">{t("issues.relationTypes.blocks")}</option>
            <option value="duplicates">{t("issues.relationTypes.duplicates")}</option>
          </Select>
          <input
            dir="ltr"
            required
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("issues.issueKeyPlaceholder", { example: `${issue.projectKey}-1` })}
            className="w-40 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm"
          />
          <Button type="submit" disabled={add.isPending}>
            {t("common.add")}
          </Button>
          <Button type="button" variant="quiet" onClick={() => setAdding(false)}>
            {t("common.cancel")}
          </Button>
          <ErrorText error={add.error} />
        </form>
      )}
      <ul className="space-y-1">
        {relations.map((r) => {
          const otherId = r.issueId === issue.id ? r.relatedIssueId : r.issueId;
          const other = byId.get(otherId);
          if (!other) return null;
          return (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="w-28 shrink-0 text-muted">{label(r)}</span>
              <StateIcon category={other.stateCategory} color={other.stateColor} />
              <Link to="/w/$slug/i/$key" params={{ slug, key: other.key }} className="truncate" dir="auto">
                <span dir="ltr">{other.key}</span> {other.title}
              </Link>
              {editable && (
                <button className="ms-auto text-muted hover:text-danger" onClick={() => remove.mutate(r.id)} aria-label={t("common.remove")}>
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Attachments({ slug, id, editable }: { slug: string; id: string; editable: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["ws", slug, "issue", id, "attachments"];
  const list = useQuery({ queryKey: key, queryFn: () => api.attachments(slug, id) });
  const upload = useMutation({
    mutationFn: (f: File) => api.upload(slug, id, f),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const items = list.data?.attachments ?? [];
  if (!items.length && !editable) return null;
  const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`);
  return (
    <section>
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("issues.attachments")}</h2>
        {editable && (
          <label className="cursor-pointer rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium text-petrol hover:bg-petrol/10">
            {t("issues.upload")}
            <input type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          </label>
        )}
      </header>
      <ErrorText error={upload.error} />
      <ul className="space-y-1">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-sm">
            <a href={api.attachmentUrl(slug, a.id)} className="truncate" dir="auto">
              {a.fileName}
            </a>
            <span className="text-xs text-muted" dir="ltr">
              {size(a.size)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Conversation({
  slug,
  id,
  members,
  canComment,
  canModerate,
}: {
  slug: string;
  id: string;
  members: Member[];
  canComment: boolean;
  canModerate: boolean;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const comments = useQuery({ queryKey: ["ws", slug, "issue", id, "comments"], queryFn: () => api.comments(slug, id) });
  const activity = useQuery({ queryKey: ["ws", slug, "issue", id, "activity"], queryFn: () => api.activity(slug, id) });
  const [draft, setDraft] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["ws", slug, "issue", id] });
  const send = useMutation({
    mutationFn: () => api.addComment(slug, id, draft),
    onSuccess: () => {
      setDraft("");
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (cid: string) => api.deleteComment(slug, cid), onSuccess: refresh });
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  type Entry = { at: string; node: ReactNode; key: string };
  const entries: Entry[] = [
    ...(activity.data?.activity ?? []).map((a) => {
      const k = a.field === "title" ? "title_" : a.field;
      const known = ["created", "state", "assigneeId", "priority", "title_", "description", "labels"].includes(k);
      const to = a.field === "state" ? String((a.toValue as { name?: string } | null)?.name ?? "") : "";
      return {
        at: a.createdAt,
        key: `a-${a.id}`,
        node: (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="size-1.5 rounded-full bg-line" />
            {t(known ? `activity.${k}` : "activity.other", {
              actor: a.actorName ?? (a.source ? t(`integrations.${a.source}`) : "?"),
              to,
              field: a.field,
            })}
            <time className="ms-auto text-xs" dateTime={a.createdAt}>
              {fmt.format(new Date(a.createdAt))}
            </time>
          </p>
        ),
      };
    }),
    ...(comments.data?.comments ?? []).map((c) => ({
      at: c.createdAt,
      key: `c-${c.id}`,
      node: (
        <article className="rounded-[var(--radius-panel)] border border-line bg-surface p-3">
          <header className="mb-2 flex items-center gap-2 text-sm">
            <Avatar name={c.authorName} />
            <span className="font-medium">{c.authorName}</span>
            <time className="text-xs text-muted" dateTime={c.createdAt}>
              {fmt.format(new Date(c.createdAt))}
            </time>
            {c.editedAt && <span className="text-xs text-muted">({t("comments.edited")})</span>}
            {(c.authorId === me.data?.user.id || canModerate) && (
              <button
                className="ms-auto text-xs text-muted hover:text-danger"
                onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(c.id)}
              >
                {t("common.delete")}
              </button>
            )}
          </header>
          <Markdown text={c.body} members={members} />
        </article>
      ),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section className="space-y-3 border-t border-line pt-6">
      <h2 className="text-sm font-semibold">{t("activity.title")}</h2>
      {entries.map((e) => (
        <div key={e.key}>{e.node}</div>
      ))}
      {canComment && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) send.mutate();
          }}
        >
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            members={members}
            rows={3}
            placeholder={t("comments.placeholder")}
            aria-label={t("comments.placeholder")}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && draft.trim()) send.mutate();
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <ErrorText error={send.error} />
            <Button type="submit" disabled={send.isPending || !draft.trim()}>
              {t("comments.send")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function PlanningProps({
  slug,
  projectId,
  cycleId,
  milestoneId,
  editable,
  onChange,
}: {
  slug: string;
  projectId: string;
  cycleId: string | null;
  milestoneId: string | null;
  editable: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const cycles = useQuery({ queryKey: ["ws", slug, "cycle", projectId], queryFn: () => api.cycles(slug, projectId) });
  const milestones = useQuery({ queryKey: ["ws", slug, "milestone", projectId], queryFn: () => api.milestones(slug, projectId) });
  const openCycles = (cycles.data?.cycles ?? []).filter((c) => !c.completedAt || c.id === cycleId);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Prop label={t("cycles.cycle")}>
        <Select disabled={!editable} value={cycleId ?? ""} onChange={(e) => onChange({ cycleId: e.target.value || null })} aria-label={t("cycles.cycle")} className="w-full">
          <option value="">{t("cycles.none")}</option>
          {openCycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || t("cycles.numbered", { number: c.number })}
            </option>
          ))}
        </Select>
      </Prop>
      <Prop label={t("milestones.milestone")}>
        <Select disabled={!editable} value={milestoneId ?? ""} onChange={(e) => onChange({ milestoneId: e.target.value || null })} aria-label={t("milestones.milestone")} className="w-full">
          <option value="">{t("milestones.none")}</option>
          {(milestones.data?.milestones ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Prop>
    </div>
  );
}

function MentionedInDocs({ slug, issueId }: { slug: string; issueId: string }) {
  const { t } = useTranslation();
  const pages = useQuery({ queryKey: ["ws", slug, "page", "issue", issueId], queryFn: () => api.issuePages(slug, issueId) });
  if (!pages.data?.pages.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{t("docs.mentionedIn")}</h2>
      <ul className="space-y-1 text-sm">
        {pages.data.pages.map((p) => (
          <li key={p.id}>
            <Link to="/w/$slug/docs/$pageId" params={{ slug, pageId: p.id }} dir="auto">
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
