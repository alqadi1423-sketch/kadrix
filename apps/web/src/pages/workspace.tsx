import { ROLES, can, canManageRole, type Role } from "@veloq/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type AuditEntry } from "../api";
import { Button, ErrorText, Field, Panel } from "../ui";

export function WorkspacePage({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const ws = useQuery({ queryKey: ["workspace", slug], queryFn: () => api.workspace(slug) });

  if (ws.isLoading) return <p className="text-muted">{t("common.loading")}</p>;
  if (ws.error || !ws.data) return <ErrorText error={ws.error} />;

  const { name, role } = ws.data.workspace;
  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-muted">
          {t("common.back")}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{name}</h1>
        <p className="text-sm text-muted">{t("workspaces.role", { role: t(`roles.${role}`) })}</p>
      </div>
      {can(role, "member.read") && <Members slug={slug} myRole={role} />}
      {can(role, "audit.read") && <Audit slug={slug} />}
    </div>
  );
}

function Members({ slug, myRole }: { slug: string; myRole: Role }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["members", slug];
  const members = useQuery({ queryKey: key, queryFn: () => api.members(slug) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["audit", slug] });
  };
  const add = useMutation({
    mutationFn: (input: { email: string; role: Role }) => api.addMember(slug, input),
    onSuccess: refresh,
  });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: Role }) => api.setRole(slug, v.userId, v.role),
    onSuccess: refresh,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    add.mutate(
      { email: String(f.get("email")), role: f.get("role") as Role },
      { onSuccess: () => form.reset() },
    );
  }

  const grantable = ROLES.filter((r) => r !== "owner" && canManageRole(myRole, null, r));

  return (
    <Panel title={t("members.title")}>
      <ul className="divide-y divide-line">
        {members.data?.members.map((m) => {
          const options = ROLES.filter((r) => r === m.role || canManageRole(myRole, m.role, r));
          return (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <div className="font-medium">{m.name}</div>
                <div className="text-sm text-muted" dir="ltr">
                  {m.email}
                </div>
              </div>
              {options.length > 1 ? (
                <select
                  aria-label={t("members.role")}
                  className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1"
                  value={m.role}
                  onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value as Role })}
                >
                  {options.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-muted">{t(`roles.${m.role}`)}</span>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorText error={setRole.error} />

      {can(myRole, "member.invite") && grantable.length > 0 && (
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <div className="min-w-56 flex-1">
            <Field label={t("members.email")} name="email" type="email" required dir="ltr" />
          </div>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t("members.role")}</span>
            <select name="role" defaultValue={grantable.includes("member") ? "member" : grantable[0]} className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2">
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
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

function Audit({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const audit = useQuery({ queryKey: ["audit", slug], queryFn: () => api.audit(slug) });
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  const describe = (e: AuditEntry) =>
    t(`audit.actions.${e.action}`, {
      actor: e.actorName ?? "?",
      target: String(e.data.targetName ?? ""),
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
