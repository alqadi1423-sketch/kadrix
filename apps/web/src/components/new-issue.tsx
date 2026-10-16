import { ISSUE_TYPES, PRIORITY_KEYS } from "@veloq/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useMembers, useProjects } from "../lib/hooks";
import { Button, Dialog, ErrorText, Select } from "../ui";
import { MentionTextarea } from "./mention-input";

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

  useEffect(() => {
    if (open) {
      setProjectId(defaults.projectId ?? projects.data?.[0]?.id ?? "");
      setDescription("");
    }
  }, [open, defaults.projectId, projects.data]);

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
    const f = new FormData(e.currentTarget);
    create.mutate({
      projectId,
      title: String(f.get("title")),
      description: description || undefined,
      type: f.get("type"),
      priority: Number(f.get("priority")),
      assigneeId: f.get("assigneeId") || null,
      parentId: defaults.parentId,
      stateId: defaults.stateId,
      stay: !!defaults.parentId,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("issues.newIssue")} wide>
      <form onSubmit={submit} className="space-y-3">
        <input
          name="title"
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
          <Select name="type" aria-label={t("issueTypes.label")} defaultValue="task">
            {ISSUE_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`issueTypes.${k}`)}
              </option>
            ))}
          </Select>
          <Select name="priority" aria-label={t("priority.label")} defaultValue="0">
            {PRIORITY_KEYS.map((k, i) => (
              <option key={k} value={i}>
                {t(`priority.${k}`)}
              </option>
            ))}
          </Select>
          <Select name="assigneeId" aria-label={t("issues.assignee")} defaultValue="">
            <option value="">{t("issues.unassigned")}</option>
            {(members.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2">
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
