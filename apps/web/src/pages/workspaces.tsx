import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { Button, ErrorText, Field, Panel } from "../ui";

export function WorkspacesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces });
  const create = useMutation({
    mutationFn: api.createWorkspace,
    onSuccess: ({ workspace }) => {
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      void navigate({ to: "/w/$slug", params: { slug: workspace.slug } });
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({ name: String(f.get("name")), slug: String(f.get("slug")) });
  }

  const workspaces = list.data?.workspaces ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("workspaces.title")}</h1>
        {!creating && <Button onClick={() => setCreating(true)}>{t("workspaces.create")}</Button>}
      </div>

      {creating && (
        <Panel title={t("workspaces.create")}>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label={t("workspaces.name")} name="name" required maxLength={80} />
            <Field
              label={t("workspaces.slug")}
              hint={t("workspaces.slugHint")}
              name="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              dir="ltr"
            />
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={create.isPending}>
                {t("common.create")}
              </Button>
              <Button type="button" variant="quiet" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </Button>
              <ErrorText error={create.error} />
            </div>
          </form>
        </Panel>
      )}

      {list.isLoading && <p className="text-muted">{t("common.loading")}</p>}
      {list.isSuccess && workspaces.length === 0 && !creating && <p className="text-muted">{t("workspaces.empty")}</p>}

      {workspaces.length > 0 && (
      <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
        {workspaces.map((w) => (
          <li key={w.id}>
            <Link
              to="/w/$slug"
              params={{ slug: w.slug }}
              className="flex items-center justify-between px-5 py-4 text-ink no-underline hover:bg-paper"
            >
              <span className="font-medium">{w.name}</span>
              <span className="text-sm text-muted">{t(`roles.${w.role}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
