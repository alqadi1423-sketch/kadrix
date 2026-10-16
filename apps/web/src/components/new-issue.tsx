import { ISSUE_TYPES, PRIORITY_KEYS } from "@veloq/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useMembers, useProjects } from "../lib/hooks";
import { Button, Dialog, ErrorText, Select } from "../ui";
import { MentionTextarea } from "./mention-input";
import { useTemplates } from "./templates";
import { useAi } from "./extend";

export function NewIssueDialog({
  slug,
  open,
  onClose,
  defaults = {},
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  defaults?: { projectId?: string; parentId?: string; stateId?: string };
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projects = useProjects(slug);
  const members = useMembers(slug);
  const [projectId, setProjectId] = useState(defaults.projectId ?? "");
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("task");
  const [priority, setPriority] = useState(0);
  const [assigneeId, setAssigneeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const templates = useTemplates(slug, projectId);

  useEffect(() => {
    if (open) {
      setProjectId(defaults.projectId ?? projects.data?.[0]?.id ?? "");
      setDescription("");
      setTitle("");
      setType("task");
      setPriority(0);
      setAssigneeId("");
      setTemplateId("");
    }
  }, [open, defaults.projectId, projects.data]);

  const template = templates.data?.find((x) => x.id === templateId);
  const ai = useAi();
  const draft = useMutation({
    mutationFn: () => api.aiDraft(slug, [title, description].filter(Boolean).join("\n\n")),
    onSuccess: ({ draft: d }) => {
      setTitle(d.title);
      setDescription(d.description);
    },
  });
  function applyTemplate(id: string) {
    setTemplateId(id);
    const tp = templates.data?.find((x) => x.id === id);
    if (!tp) return;
    if (tp.title) setTitle(tp.title);
    setDescription(tp.description ?? "");
    setType(tp.defaults.type ?? "task");
    setPriority(tp.defaults.priority ?? 0);
    setAssigneeId(tp.defaults.assigneeId ?? "");
  }

  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) => api.createIssue(slug, input),
    onSuccess: ({ issue }, vars) => {
      void qc.invalidateQueries({ queryKey: ["ws", slug, "issues"] });
      if (defaults.parentId) void qc.invalidateQueries({ queryKey: ["ws", slug, "issue", defaults.parentId] });
      onClose();
      if (!(vars as { stay?: boolean }).stay) void navigate({ to: "/w/$slug/i/$key", params: { slug, key: issue.key } });
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    create.mutate({
      projectId,
      title,
      description: description || undefined,
      type,
      priority,
      assigneeId: assigneeId || null,
      ...(template?.defaults.labelIds?.length ? { labelIds: template.defaults.labelIds } : {}),
      ...(template?.defaults.estimate != null ? { estimate: template.defaults.estimate } : {}),
      ...(template?.defaults.fields && Object.keys(template.defaults.fields).length ? { fields: template.defaults.fields } : {}),
      parentId: defaults.parentId,
      stateId: defaults.stateId,
      stay: !!defaults.parentId,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("issues.newIssue")} wide>
      <form onSubmit={submit} className="space-y-3">
        {!!templates.data?.length && (
          <Select aria-label={t("templates.use")} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">{t("templates.blank")}</option>
            {templates.data.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </Select>
        )}
        <input
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={250}
          autoFocus
          dir="auto"
          placeholder={t("issues.title")}
          aria-label={t("issues.title")}
          className="w-full border-0 bg-transparent text-lg font-medium outline-none"
        />
        <MentionTextarea
          value={description}
          onChange={setDescription}
          members={members.data ?? []}
          rows={5}
          placeholder={t("issues.descriptionPlaceholder")}
          aria-label={t("issues.description")}
        />
        <div className="flex flex-wrap gap-2">
          <Select aria-label={t("issues.project")} value={projectId} onChange={(e) => setProjectId(e.target.value)} required disabled={!!defaults.projectId}>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select name="type" aria-label={t("issueTypes.label")} value={type} onChange={(e) => setType(e.target.value)}>
            {ISSUE_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`issueTypes.${k}`)}
              </option>
            ))}
          </Select>
          <Select name="priority" aria-label={t("priority.label")} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {PRIORITY_KEYS.map((k, i) => (
              <option key={k} value={i}>
                {t(`priority.${k}`)}
              </option>
            ))}
          </Select>
          <Select name="assigneeId" aria-label={t("issues.assignee")} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">{t("issues.unassigned")}</option>
            {(members.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <ErrorText error={create.error ?? draft.error} />
        <div className="flex justify-end gap-2">
          {ai.data && (
            <Button type="button" variant="quiet" className="me-auto" disabled={draft.isPending || (title + description).trim().length < 3} onClick={() => draft.mutate()}>
              {draft.isPending ? t("ai.drafting") : t("ai.draft")}
            </Button>
          )}
          <Button type="button" variant="quiet" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={create.isPending || !projectId}>
            {t("issues.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
