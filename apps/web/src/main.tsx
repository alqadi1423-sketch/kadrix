import "./styles.css";
import "./i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { authClient } from "./api";
import { AuthPage } from "./pages/auth";
import { WorkspacePage } from "./pages/workspace";
import { WorkspacesPage } from "./pages/workspaces";
import { Shell } from "./shell";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Root() {
  const { t } = useTranslation();
  const session = authClient.useSession();
  if (session.isPending) return <p className="p-8 text-muted">{t("common.loading")}</p>;
  if (!session.data) return <AuthPage onDone={() => void session.refetch()} />;
  return (
    <Shell signedIn>
      <Outlet />
    </Shell>
  );
}

const rootRoute = createRootRoute({ component: Root });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: WorkspacesPage });
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$slug",
  component: function WorkspaceRoute() {
    const { slug } = workspaceRoute.useParams();
    return <WorkspacePage slug={slug} />;
  },
});

const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, workspaceRoute]) });

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
