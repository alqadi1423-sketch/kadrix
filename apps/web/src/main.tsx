import "./styles.css";
import "./i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { authClient } from "./api";
import { WorkspaceLayout } from "./layout";
import { AuthPage } from "./pages/auth";
import { InboxPage } from "./pages/inbox";
import { IssuePage } from "./pages/issue";
import { MyIssuesPage } from "./pages/my-issues";
import { ProjectPage } from "./pages/project";
import { ProjectsPage } from "./pages/projects";
import { SettingsPage } from "./pages/settings";
import { ViewsPage } from "./pages/views";
import { WorkspacesPage } from "./pages/workspaces";
import { Shell } from "./shell";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });

function Root() {
  const { t } = useTranslation();
  const session = authClient.useSession();
  if (session.isPending) return <p className="p-8 text-muted">{t("common.loading")}</p>;
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
const viewsRoute = createRoute({ getParentRoute: () => wsRoute, path: "/views", component: ViewsPage });
const settingsRoute = createRoute({ getParentRoute: () => wsRoute, path: "/settings", component: () => <SettingsPage /> });

const routeTree = rootRoute.addChildren([
  indexRoute,
  wsRoute.addChildren([myIssuesRoute, inboxRoute, projectsRoute, projectRoute, issueRoute, viewsRoute, settingsRoute]),
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
