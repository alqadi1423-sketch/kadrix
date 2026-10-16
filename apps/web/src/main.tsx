import "./styles.css";
import "./i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { authClient } from "./api";
import { WorkspaceLayout } from "./layout";
import { AuthPage } from "./pages/auth";
import { DocsPage } from "./pages/docs";
import { InboxPage } from "./pages/inbox";
import { InitiativesPage } from "./pages/initiatives";
import { IssuePage } from "./pages/issue";
import { MyIssuesPage } from "./pages/my-issues";
import { ProjectPage } from "./pages/project";
import { ProjectsPage } from "./pages/projects";
import { ReportsPage } from "./pages/reports";
import { SettingsPage } from "./pages/settings";
import { ViewsPage, WorkspaceCalendar } from "./pages/views";
import { WorkspacesPage } from "./pages/workspaces";
import { Shell } from "./shell";
import { AgentsSettings, IntegrationsSettings, TokensSettings, WebhooksSettings } from "./components/dev";
import { AutomationSettings, FieldsSettings, ImportSettings } from "./components/settings-extend";
import { can } from "@veloq/core";

function Settings() {
  const { t } = useTranslation();
  return (
    <SettingsPage
      extraTabs={[
        { id: "fields", label: t("fields.title"), show: (r) => can(r, "field.manage"), render: (s) => <FieldsSettings slug={s} /> },
        { id: "automation", label: t("automation.title"), show: (r) => can(r, "automation.manage"), render: (s) => <AutomationSettings slug={s} /> },
        { id: "import", label: t("importer.title"), show: (r) => can(r, "import.run"), render: (s) => <ImportSettings slug={s} /> },
        { id: "integrations", label: t("integrations.title"), show: (r) => can(r, "integration.manage"), render: (s) => <IntegrationsSettings slug={s} /> },
        { id: "webhooks", label: t("webhooks.title"), show: (r) => can(r, "webhook.manage"), render: (s) => <WebhooksSettings slug={s} /> },
        { id: "agents", label: t("agents.title"), show: (r) => can(r, "agent.manage"), render: (s) => <AgentsSettings slug={s} /> },
        { id: "tokens", label: t("tokens.title"), show: (r) => can(r, "token.manage"), render: (s) => <TokensSettings slug={s} /> },
      ]}
    />
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });

function Root() {
  const { t } = useTranslation();
  const session = authClient.useSession();
  // Only the first load shows a spinner: later refetches (after sign-in)
  // must not unmount the sign-in page while it asks for a second factor.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!session.isPending) setLoaded(true);
  }, [session.isPending]);
  if (!loaded && session.isPending) return <p className="p-8 text-muted">{t("common.loading")}</p>;
  if (!session.data) return <AuthPage onDone={() => void session.refetch()} />;
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: Root });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <Shell>
      <WorkspacesPage />
    </Shell>
  ),
});
const wsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/w/$slug", component: WorkspaceLayout });
const myIssuesRoute = createRoute({ getParentRoute: () => wsRoute, path: "/", component: MyIssuesPage });
const inboxRoute = createRoute({ getParentRoute: () => wsRoute, path: "/inbox", component: InboxPage });
const projectsRoute = createRoute({ getParentRoute: () => wsRoute, path: "/projects", component: ProjectsPage });
const projectRoute = createRoute({ getParentRoute: () => wsRoute, path: "/p/$projectId", component: ProjectPage });
const issueRoute = createRoute({ getParentRoute: () => wsRoute, path: "/i/$key", component: IssuePage });
const initiativesRoute = createRoute({ getParentRoute: () => wsRoute, path: "/initiatives", component: InitiativesPage });
const calendarRoute = createRoute({ getParentRoute: () => wsRoute, path: "/calendar", component: WorkspaceCalendar });
const docsRoute = createRoute({ getParentRoute: () => wsRoute, path: "/docs", component: DocsPage });
const docRoute = createRoute({ getParentRoute: () => wsRoute, path: "/docs/$pageId", component: DocsPage });
const reportsRoute = createRoute({ getParentRoute: () => wsRoute, path: "/reports", component: ReportsPage });
const viewsRoute = createRoute({ getParentRoute: () => wsRoute, path: "/views", component: ViewsPage });
const settingsRoute = createRoute({ getParentRoute: () => wsRoute, path: "/settings", component: Settings });

const routeTree = rootRoute.addChildren([
  indexRoute,
  wsRoute.addChildren([myIssuesRoute, inboxRoute, projectsRoute, projectRoute, issueRoute, viewsRoute, settingsRoute, initiativesRoute, calendarRoute, docsRoute, docRoute, reportsRoute]),
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

// Installable app with an offline shell (production builds only).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
