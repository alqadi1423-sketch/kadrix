import { can } from "@kadrix/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { keys, useProjects, useWorkspace } from "../lib/hooks";
import { Button, Dialog, Empty, ErrorText, Field } from "../ui";

export function ProjectsPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { t } = useTranslation();
  const projects = useProjects(slug);
  const ws = useWorkspace(slug);
  const [open, setOpen] = useState(false);
  const role = ws.data?.workspace.role;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("projects.title")}</h1>
        {can(role, "project.create") && <Button onClick={() => setOpen(true)}>{t("projects.create")}</Button>}
      </div>
      {projects.isSuccess && projects.data.length === 0 && <Empty>{t("projects.empty")}</Empty>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {(projects.data ?? []).map((p) => (
          <li key={p.id}>
            <Link
              to="/w/$slug/p/$projectId"
              params={{ slug, projectId: p.id }}
              className="block rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-ink no-underline hover:border-petrol"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded bg-paper px-1.5 text-xs text-muted" dir="ltr">
                  {p.key}
                </span>
                <span className="font-medium" dir="auto">
                  {p.name}
                </span>
              </div>
              {p.description && (
                <p className="line-clamp-2 text-sm text-muted" dir="auto">
                  {p.description}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <CreateProject slug={slug} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function CreateProject({ slug, open, onClose }: { slug: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: (input: { name: string; key: string; description?: string }) => api.createProject(slug, input),
    onSuccess: ({ project }) => {
      void qc.invalidateQueries({ queryKey: keys.projects(slug) });
      onClose();
      void navigate({ to: "/w/$slug/p/$projectId", params: { slug, projectId: project.id } });
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      name: String(f.get("name")),
      key: String(f.get("key")).toUpperCase(),
      description: String(f.get("description") || "") || undefined,
    });
  }
  return (
    <Dialog open={open} onClose={onClose} title={t("projects.create")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("projects.name")} name="name" required maxLength={80} dir="auto" />
        <Field
          label={t("projects.key")}
          hint={t("projects.keyHint", { example: "WEB-12" })}
          name="key"
          required
          pattern="[A-Za-z][A-Za-z0-9]{1,5}"
          dir="ltr"
          className="uppercase"
        />
        <Field label={t("projects.description")} name="description" maxLength={2000} dir="auto" />
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
