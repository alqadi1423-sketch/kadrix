import { can } from "@kadrix/core";
import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api, authClient } from "./api";
import { CommandPalette } from "./components/command-palette";
import { NewIssueDialog } from "./components/new-issue";
import { keys, useProjects, useWorkspace } from "./lib/hooks";
import { useRealtime } from "./lib/realtime";
import { useShortcuts } from "./lib/shortcuts";
import { Brand, LanguageSwitch } from "./shell";
import { Dialog } from "./ui";

interface WorkspaceUi {
  newIssue: (defaults?: { projectId?: string; parentId?: string; stateId?: string }) => void;
}
const Ctx = createContext<WorkspaceUi>({ newIssue: () => {} });
export const useWorkspaceUi = () => useContext(Ctx);

export function WorkspaceLayout() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ws = useWorkspace(slug);
  const projects = useProjects(slug);
  const unread = useQuery({
    queryKey: keys.notifications(slug),
    queryFn: () => api.notifications(slug),
    select: (d) => d.notifications.filter((n) => !n.readAt).length,
  });
  useRealtime(slug);

  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);
  const [newIssue, setNewIssue] = useState<{ open: boolean; defaults: Parameters<WorkspaceUi["newIssue"]>[0] }>({
    open: false,
    defaults: {},
  });
  const openNew = useCallback((defaults: Parameters<WorkspaceUi["newIssue"]>[0] = {}) => setNewIssue({ open: true, defaults }), []);
  const ui = useMemo(() => ({ newIssue: openNew }), [openNew]);

  const shortcuts = useMemo(
    () => ({
      palette: () => setPalette(true),
      newIssue: () => openNew(),
      help: () => setHelp(true),
      go: (k: "i" | "m" | "p") => {
        const to = { i: "/w/$slug/inbox", m: "/w/$slug", p: "/w/$slug/projects" }[k];
        void navigate({ to: to as never, params: { slug } as never });
      },
    }),
    [navigate, openNew, slug],
  );
  useShortcuts(shortcuts);

  if (ws.error) {
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          <p className="mb-4 text-muted">{t("errors.notFound")}</p>
          <Link to="/">{t("common.back")}</Link>
        </div>
      </div>
    );
  }

  const nav = (
    <nav className="flex flex-col gap-0.5 text-sm" aria-label={t("app.name")}>
      <NavLink to="/w/$slug/inbox" slug={slug}>
        <span className="flex-1">{t("nav.inbox")}</span>
        {!!unread.data && <span className="rounded-full bg-petrol px-1.5 text-xs text-white tabular-nums dark:text-ink">{unread.data}</span>}
      </NavLink>
      <NavLink to="/w/$slug" slug={slug} exact>
        {t("nav.myIssues")}
      </NavLink>
      <NavLink to="/w/$slug/views" slug={slug}>
        {t("nav.views")}
      </NavLink>
      {can(ws.data?.workspace.role, "report.read") && (
        <NavLink to="/w/$slug/reports" slug={slug}>
          {t("nav.reports")}
        </NavLink>
      )}
      <NavLink to="/w/$slug/docs" slug={slug}>
        {t("docs.title")}
      </NavLink>
      <NavLink to="/w/$slug/initiatives" slug={slug}>
        {t("initiatives.title")}
      </NavLink>
      <NavLink to="/w/$slug/calendar" slug={slug}>
        {t("calendar.title")}
      </NavLink>
      <div className="mt-4 mb-1 flex items-center justify-between px-2 text-xs text-muted">
        <Link to="/w/$slug/projects" params={{ slug }} className="text-muted no-underline hover:text-ink">
          {t("nav.projects")}
        </Link>
      </div>
      {(projects.data ?? []).map((p) => (
        <Link
          key={p.id}
          to="/w/$slug/p/$projectId"
          params={{ slug, projectId: p.id }}
          className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-ink no-underline hover:bg-paper"
          activeProps={{ className: "bg-paper font-medium" }}
        >
          <span className="w-10 text-xs text-muted" dir="ltr">
            {p.key}
          </span>
          <span className="truncate">{p.name}</span>
        </Link>
      ))}
      <div className="mt-4" />
      <NavLink to="/w/$slug/settings" slug={slug}>
        {t("nav.settings")}
      </NavLink>
    </nav>
  );

  return (
    <Ctx.Provider value={ui}>
      <div className="flex min-h-dvh">
        <aside className="hidden w-60 shrink-0 flex-col border-e border-line bg-surface p-3 md:flex">
          <SidebarHeader name={ws.data?.workspace.name ?? ""} onSearch={() => setPalette(true)} onNew={() => openNew()} />
          {nav}
          <SidebarFooter />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
            <button className="px-2 py-1 text-ink" aria-label={t("app.name")} aria-expanded={menu} onClick={() => setMenu(!menu)}>
              ☰
            </button>
            <Brand />
            <span className="flex-1" />
            <button className="px-2 text-muted" onClick={() => setPalette(true)}>
              {t("common.search")}
            </button>
          </header>
          {menu && (
            <div className="border-b border-line bg-surface p-3 md:hidden" onClick={() => setMenu(false)}>
              {nav}
            </div>
          )}
          <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
            <Outlet />
          </main>
        </div>
      </div>
      <button
        onClick={() => openNew()}
        aria-label={t("issues.newIssue")}
        className="fixed bottom-5 end-5 grid size-12 place-items-center rounded-full bg-petrol text-2xl text-white shadow-lg md:hidden dark:text-ink"
      >
        +
      </button>
      <CommandPalette
        slug={slug}
        open={palette}
        onClose={() => setPalette(false)}
        onNewIssue={() => openNew()}
        onShortcuts={() => setHelp(true)}
      />
      <NewIssueDialog
        slug={slug}
        open={newIssue.open}
        defaults={newIssue.defaults}
        onClose={() => setNewIssue((s) => ({ ...s, open: false }))}
      />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
    </Ctx.Provider>
  );
}

function NavLink({ to, slug, children, exact }: { to: string; slug: string; children: ReactNode; exact?: boolean }) {
  return (
    <Link
      to={to as never}
      params={{ slug } as never}
      activeOptions={{ exact }}
      className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-ink no-underline hover:bg-paper"
      activeProps={{ className: "bg-paper font-medium" }}
    >
      {children}
    </Link>
  );
}

function SidebarHeader({ name, onSearch, onNew }: { name: string; onSearch: () => void; onNew: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <Brand />
        <Link to="/" className="text-xs text-muted no-underline hover:text-ink" title={t("nav.workspaces")}>
          ⇄
        </Link>
      </div>
      <div className="truncate px-2 text-sm font-medium" dir="auto">
        {name}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onSearch}
          className="flex flex-1 items-center justify-between rounded-[var(--radius-control)] border border-line px-2 py-1.5 text-sm text-muted hover:text-ink"
        >
          {t("common.search")}
          <kbd className="text-xs" dir="ltr">
            ⌘K
          </kbd>
        </button>
        <button
          onClick={onNew}
          title={t("issues.newIssue")}
          aria-label={t("issues.newIssue")}
          className="rounded-[var(--radius-control)] bg-petrol px-2.5 text-white dark:text-ink"
        >
          +
        </button>
      </div>
    </div>
  );
}

function SidebarFooter() {
  const { t } = useTranslation();
  return (
    <div className="mt-auto flex items-center justify-between gap-2 pt-4">
      <LanguageSwitch />
      <button
        className="text-sm text-muted hover:text-ink"
        onClick={() => authClient.signOut().then(() => window.location.assign("/"))}
      >
        {t("common.signOut")}
      </button>
    </div>
  );
}

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    ["⌘K / Ctrl K", t("shortcuts.palette")],
    ["/", t("shortcuts.search")],
    ["C", t("shortcuts.newIssue")],
    ["G I", t("shortcuts.goInbox")],
    ["G M", t("shortcuts.goMyIssues")],
    ["?", t("shortcuts.help")],
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t("shortcuts.title")}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd dir="ltr" className="rounded border border-line px-1.5 py-0.5 text-xs">
                {k}
              </kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
