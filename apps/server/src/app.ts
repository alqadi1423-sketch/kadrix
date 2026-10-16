import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { type AppDeps, type Env, requireUser } from "./context.js";
import { ApiError } from "./errors.js";
import { issueRoutes } from "./routes/issues.js";
import { projectRoutes } from "./routes/projects.js";
import { workspaceRoutes } from "./routes/workspaces.js";

export type { AppDeps } from "./context.js";

export function createApp(deps: AppDeps) {
  const { auth, edition } = deps;
  const app = new Hono<Env>().basePath("/api");

  app.use("*", secureHeaders());

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.code }, err.status);
    console.error(err);
    return c.json({ error: "generic" }, 500);
  });

  app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

  // Resolve the caller once per request.
  app.use("*", async (c, next) => {
    c.set("tokenWorkspaceId", null);
    const s = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", s ? { id: s.user.id, name: s.user.name, email: s.user.email } : null);
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true, edition }));
  app.get("/me", (c) => c.json({ user: requireUser(c) }));

  app.route("/", workspaceRoutes(deps));
  app.route("/", projectRoutes(deps));
  app.route("/", issueRoutes(deps));

  return app;
}
