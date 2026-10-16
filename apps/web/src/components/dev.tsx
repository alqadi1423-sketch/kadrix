import { PR_EVENTS, WEBHOOK_EVENTS } from "@veloq/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, type Integration, type PrMapping } from "../api";
import { Button, ErrorText, Field, Panel, Select } from "../ui";

function useFmt() {
  const { i18n } = useTranslation();
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-line bg-paper px-2 py-1.5 text-sm">
          {value}
        </code>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
    </div>
  );
}

/** Shown once after creating a token, webhook or integration. */
function OneTimeSecret({ children }: { children: ReactNode }) {
  return <div className="space-y-3 rounded-[var(--radius-panel)] border-2 border-signal/60 bg-signal/10 p-4">{children}</div>;
}

/* ---------------------------- issue: development --------------------------- */

const PR_STATE_STYLE: Record<string, string> = {
  draft: "border border-line text-muted",
  open: "bg-[#2e8b57]/15 text-ink",
  merged: "bg-[#8e6bb8]/20 text-ink",
  closed: "bg-danger/15 text-ink",
};

export function DevSection({ slug, issueId, issueKey }: { slug: string; issueId: string; issueKey: string }) {
  const { t } = useTranslation();
  const links = useQuery({ queryKey: ["ws", slug, "issue", issueId, "links"], queryFn: () => api.links(slug, issueId) });
  if (!links.data) return null;
  const { branch } = links.data;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{t("dev.title")}</h2>
      <CopyField label={t("dev.branch")} value={branch} />
      {links.data.links.length === 0 ? (
        <p className="text-sm text-muted">{t("dev.noLinks", { key: issueKey })}</p>
      ) : (
        <ul className="space-y-1">
          {links.data.links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 text-xs text-muted">{l.kind === "commit" ? t("dev.commit") : t("dev.pullRequest")}</span>
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="truncate" dir="auto">
                {l.title || l.url}
              </a>
              {l.state && (
                <span className={`ms-auto shrink-0 rounded-full px-2 py-0.5 text-xs ${PR_STATE_STYLE[l.state] ?? ""}`}>
                  {t(`dev.states.${l.state}`)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------- API tokens ------------------------------- */

export function TokensSettings({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fmt = useFmt();
  const key = ["ws", slug, "tokens"];
  const list = useQuery({ queryKey: key, queryFn: () => api.tokens(slug) });
  const [fresh, setFresh] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (input: { name: string; scopes: string[]; expiresInDays: number | null }) => api.createToken(slug, input),
    onSuccess: (r) => {
      setFresh(r.token.value);
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeToken(slug, id), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  return (
    <Panel title={t("tokens.title")} action={<a href="/api/openapi.json" target="_blank" rel="noreferrer" className="text-sm">{t("tokens.docs")}</a>}>
      <div className="space-y-4">
        {fresh && (
          <OneTimeSecret>
            <p className="text-sm">{t("tokens.copyNow")}</p>
            <CopyField label={t("tokens.name")} value={fresh} />
          </OneTimeSecret>
        )}
        {list.data?.tokens.length === 0 && <p className="text-muted">{t("tokens.empty")}</p>}
        <ul className="divide-y divide-line">
          {list.data?.tokens.map((tk) => (
            <li key={tk.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-medium">{tk.name}</span>
              <code dir="ltr" className="text-xs text-muted">
                {tk.prefix}…
              </code>
              <span className="text-xs text-muted">{tk.scopes.includes("write") ? t("tokens.write") : t("tokens.read")}</span>
              <span className="text-xs text-muted">
                {tk.lastUsedAt ? t("tokens.lastUsed", { date: fmt.format(new Date(tk.lastUsedAt)) }) : t("tokens.neverUsed")}
              </span>
              <Button variant="danger" className="ms-auto" onClick={() => window.confirm(t("common.confirmDelete")) && revoke.mutate(tk.id)}>
                {t("tokens.revoke")}
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const days = Number(f.get("days") || 0);
            create.mutate({
              name: String(f.get("name")),
              scopes: f.get("scope") === "write" ? ["read", "write"] : ["read"],
              expiresInDays: days > 0 ? days : null,
            });
            e.currentTarget.reset();
          }}
        >
          <div className="min-w-40 flex-1">
            <Field label={t("tokens.name")} name="name" required maxLength={60} dir="auto" />
          </div>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">{t("tokens.scopes")}</span>
            <Select name="scope" defaultValue="read" className="py-2">
              <option value="read">{t("tokens.read")}</option>
              <option value="write">{t("tokens.write")}</option>
            </Select>
          </label>
          <div className="w-32">
            <Field label={t("tokens.expires")} name="days" type="number" min={1} max={366} placeholder="90" />
          </div>
          <Button type="submit">{t("tokens.create")}</Button>
          <div className="basis-full">
            <ErrorText error={create.error} />
          </div>
        </form>
      </div>
    </Panel>
  );
}

/* -------------------------------- webhooks -------------------------------- */

export function WebhooksSettings({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["ws", slug, "webhooks"];
  const list = useQuery({ queryKey: key, queryFn: () => api.webhooks(slug) });
  const [fresh, setFresh] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: (input: { url: string; events: string[] }) => api.createWebhook(slug, input),
    onSuccess: (r) => {
      setFresh(r.webhook.secret);
      void refresh();
    },
  });
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => api.updateWebhook(slug, v.id, { active: v.active }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteWebhook(slug, id), onSuccess: refresh });
  const ping = useMutation({
    mutationFn: (id: string) => api.pingWebhook(slug, id),
    onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: [...key, id] }),
  });
  return (
    <Panel title={t("webhooks.title")}>
      <div className="space-y-4">
        {fresh && (
          <OneTimeSecret>
            <p className="text-sm">{t("webhooks.secretOnce")}</p>
            <CopyField label={t("integrations.secret")} value={fresh} />
          </OneTimeSecret>
        )}
        {list.data?.webhooks.length === 0 && <p className="text-muted">{t("webhooks.empty")}</p>}
        <ul className="divide-y divide-line">
          {list.data?.webhooks.map((h) => (
            <li key={h.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <code dir="ltr" className="min-w-0 truncate">
                  {h.url}
                </code>
                <span className={`rounded-full px-2 py-0.5 text-xs ${h.active ? "bg-[#2e8b57]/15" : "border border-line text-muted"}`}>
                  {h.active ? t("webhooks.active") : t("webhooks.paused")}
                </span>
                {h.failing > 0 && <span className="text-xs text-danger">{t("webhooks.failing", { count: h.failing })}</span>}
                <span className="ms-auto flex gap-1">
                  <Button variant="quiet" onClick={() => ping.mutate(h.id)}>
                    {t("webhooks.ping")}
                  </Button>
                  <Button variant="quiet" onClick={() => toggle.mutate({ id: h.id, active: !h.active })}>
                    {h.active ? t("webhooks.paused") : t("webhooks.active")}
                  </Button>
                  <Button variant="quiet" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>
                    {t("webhooks.deliveries")}
                  </Button>
                  <Button variant="danger" onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(h.id)}>
                    {t("common.delete")}
                  </Button>
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {h.events.map((e) => (
                  <code key={e} className="rounded bg-paper px-1.5 text-xs text-muted" dir="ltr">
                    {e}
                  </code>
                ))}
              </div>
              {open === h.id && <Deliveries slug={slug} id={h.id} />}
            </li>
          ))}
        </ul>
        <form
          className="space-y-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            create.mutate({ url: String(f.get("url")), events: f.getAll("events").map(String) }, { onSuccess: () => form.reset() });
          }}
        >
          <Field label={t("webhooks.url")} name="url" type="url" required dir="ltr" placeholder="https://" />
          <fieldset>
            <legend className="mb-1 text-sm text-muted">{t("webhooks.events")}</legend>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-xs">
                  <input type="checkbox" name="events" value={e} defaultChecked={e.startsWith("issue")} className="accent-petrol" />
                  <code dir="ltr">{e}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" disabled={create.isPending}>
            {t("webhooks.create")}
          </Button>
          <ErrorText error={create.error} />
        </form>
      </div>
    </Panel>
  );
}

function Deliveries({ slug, id }: { slug: string; id: string }) {
  const fmt = useFmt();
  const list = useQuery({ queryKey: ["ws", slug, "webhooks", id], queryFn: () => api.deliveries(slug, id), refetchInterval: 5000 });
  return (
    <table className="w-full text-xs">
      <tbody>
        {list.data?.deliveries.map((d) => (
          <tr key={d.id} className="border-t border-line">
            <td className="py-1 pe-2" dir="ltr">
              <code>{d.event}</code>
            </td>
            <td className={`py-1 pe-2 ${d.status === "failed" ? "text-danger" : d.status === "success" ? "" : "text-muted"}`}>
              {d.status} {d.lastStatusCode ? `(${d.lastStatusCode})` : ""}
            </td>
            <td className="py-1 pe-2 tabular-nums">×{d.attempts}</td>
            <td className="py-1 text-muted">{fmt.format(new Date(d.createdAt))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------ integrations ------------------------------ */

export function IntegrationsSettings({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["ws", slug, "integrations"];
  const list = useQuery({ queryKey: key, queryFn: () => api.integrations(slug) });
  const [fresh, setFresh] = useState<(Integration & { secret: string }) | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: (input: { provider: "github" | "gitlab"; name: string }) => api.createIntegration(slug, input),
    onSuccess: (r) => {
      setFresh(r.integration);
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteIntegration(slug, id), onSuccess: refresh });
  const fmt = useFmt();
  return (
    <Panel title={t("integrations.title")}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t("integrations.howItWorks", { branch: "web-12-login-page", key: "WEB-12" })}</p>
        {fresh && (
          <OneTimeSecret>
            <p className="text-sm">{fresh.provider === "github" ? t("integrations.setupGithub") : t("integrations.setupGitlab")}</p>
            <CopyField label={t("integrations.endpoint")} value={fresh.endpoint} />
            <CopyField label={t("integrations.secret")} value={fresh.secret} />
          </OneTimeSecret>
        )}
        {list.data?.integrations.length === 0 && <p className="text-muted">{t("integrations.empty")}</p>}
        <ul className="space-y-3">
          {list.data?.integrations.map((i) => (
            <li key={i.id} className="space-y-3 rounded-[var(--radius-control)] border border-line p-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">{t(`integrations.${i.provider}`)}</span>
                <span dir="auto">{i.name}</span>
                <span className="text-xs text-muted">
                  {i.lastEventAt ? t("integrations.lastEvent", { date: fmt.format(new Date(i.lastEventAt)) }) : t("integrations.noEvents")}
                </span>
                <Button variant="danger" className="ms-auto" onClick={() => window.confirm(t("common.confirmDelete")) && remove.mutate(i.id)}>
                  {t("integrations.disconnect")}
                </Button>
              </div>
              <CopyField label={t("integrations.endpoint")} value={i.endpoint} />
              <MappingEditor slug={slug} integration={i} onSaved={refresh} />
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            create.mutate({ provider: f.get("provider") as "github" | "gitlab", name: String(f.get("name")) }, { onSuccess: () => form.reset() });
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm text-muted">Git</span>
            <Select name="provider" defaultValue="github" className="py-2">
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </Select>
          </label>
          <div className="min-w-48 flex-1">
            <Field label={t("integrations.name")} name="name" required maxLength={60} dir="ltr" placeholder="acme/app" />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {t("integrations.connect")}
          </Button>
          <div className="basis-full">
            <ErrorText error={create.error} />
          </div>
        </form>
      </div>
    </Panel>
  );
}

function MappingEditor({ slug, integration, onSaved }: { slug: string; integration: Integration; onSaved: () => void }) {
  const { t } = useTranslation();
  const [m, setM] = useState<PrMapping>(integration.config);
  const save = useMutation({ mutationFn: (cfg: PrMapping) => api.updateIntegration(slug, integration.id, cfg), onSuccess: onSaved });
  const set = (patch: Partial<PrMapping>) => {
    const next = { ...m, ...patch };
    setM(next);
    save.mutate(next);
  };
  return (
    <details>
      <summary className="cursor-pointer text-sm text-petrol">{t("integrations.mapping")}</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {PR_EVENTS.map((ev) => (
          <label key={ev} className="flex items-center justify-between gap-2 text-sm">
            <span>{t(`prEvents.${ev}`)}</span>
            <Select value={m[ev] ?? ""} onChange={(e) => set({ [ev]: (e.target.value || null) as PrMapping[typeof ev] })}>
              <option value="">{t("integrations.noMove")}</option>
              <option value="started">{t("stateCategories.started")}</option>
              <option value="completed">{t("stateCategories.completed")}</option>
            </Select>
          </label>
        ))}
        <label className="flex items-center justify-between gap-2 text-sm sm:col-span-2">
          <span>{t("integrations.reviewState")}</span>
          <input
            defaultValue={m.reviewStateName ?? ""}
            dir="auto"
            onBlur={(e) => e.target.value !== (m.reviewStateName ?? "") && set({ reviewStateName: e.target.value.trim() || null })}
            className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1"
          />
        </label>
      </div>
      <ErrorText error={save.error} />
    </details>
  );
}
