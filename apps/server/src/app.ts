import { apiToken, user } from "@veloq/db";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { type AppDeps, type Env, requireUser } from "./context.js";
import { hashToken } from "./crypto.js";
import { ApiError, forbidden, unauthorized } from "./errors.js";
import { openApiDocument } from "./openapi.js";
import { clientIp, rateLimit } from "./ratelimit.js";
import { devlinkRoutes } from "./routes/devlink.js";
import { issueRoutes } from "./routes/issues.js";
import { planningRoutes } from "./routes/planning.js";
import { projectRoutes } from "./routes/projects.js";
import { workspaceRoutes } from "./routes/workspaces.js";

export type { AppDeps } from "./context.js";

export function createApp(deps: AppDeps) {
  const { auth, edition, db } = deps;
  const app = new Hono<Env>().basePath("/api");

  app.use("*", secureHeaders());

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.code }, err.status);
    console.error(err);
    return c.json({ error: "generic" }, 500);
  });

  app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

  // Resolve the caller once per request: API token first, then session cookie.
  app.use("*", async (c, next) => {
    c.set("tokenWorkspaceId", null);
    c.set("tokenScopes", null);
    const header = c.req.header("authorization") ?? "";
    if (header.toLowerCase().startsWith("bearer ")) {
      const token = header.slice(7).trim();
      const [row] = await db
        .select({
          id: apiToken.id,
          workspaceId: apiToken.workspaceId,
          scopes: apiToken.scopes,
          expiresAt: apiToken.expiresAt,
          lastUsedAt: apiToken.lastUsedAt,
          userId: user.id,
          name: user.name,
          email: user.email,
        })
        .from(apiToken)
        .innerJoin(user, eq(user.id, apiToken.userId))
        .where(and(eq(apiToken.tokenHash, hashToken(token)), isNull(apiToken.revokedAt)));
      if (!row || (row.expiresAt && row.expiresAt < new Date())) throw unauthorized();
      // Read-only tokens cannot change anything.
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && !row.scopes.includes("write")) throw forbidden();
      c.set("user", { id: row.userId, name: row.name, email: row.email });
      c.set("tokenWorkspaceId", row.workspaceId);
      c.set("tokenScopes", row.scopes);
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
        await db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, row.id));
      }
    } else {
      const s = await auth.api.getSession({ headers: c.req.raw.headers });
      c.set("user", s ? { id: s.user.id, name: s.user.name, email: s.user.email } : null);
    }
    await next();
  });

  app.use("*", rateLimit(deps.rateLimitPerMinute ?? 0, (c) => c.get("user")?.id ?? clientIp(c)));

  app.get("/health", (c) => c.json({ ok: true, edition }));
  app.get("/me", (c) => c.json({ user: requireUser(c) }));
  app.get("/openapi.json", (c) => c.json(openApiDocument(deps.baseUrl)));

  app.route("/", workspaceRoutes(deps));
  app.route("/", projectRoutes(deps));
  app.route("/", issueRoutes(deps));
  app.route("/", planningRoutes(deps));
  app.route("/", devlinkRoutes(deps));

  return app;
}
