import { apiToken, user, userPreference } from "@veloq/db";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { type AppDeps, type Env, parseBody, requireUser } from "./context.js";
import { CLIENT_IP_HEADER } from "./auth.js";
import { hashToken } from "./crypto.js";
import { editionFeatures } from "@veloq/core";
import { ApiError, forbidden, unauthorized } from "./errors.js";
import { openApiDocument } from "./openapi.js";
import { clientIp, rateLimit } from "./ratelimit.js";
import { devlinkRoutes } from "./routes/devlink.js";
import { extendRoutes } from "./routes/extend.js";
import { issueRoutes } from "./routes/issues.js";
import { pageRoutes } from "./routes/pages.js";
import { agentRoutes } from "./routes/agents.js";
import { aiRoutes } from "./routes/ai.js";
import { mountMcp } from "./mcp.js";
import { VERSION } from "./version.js";
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

  const ipOf = (c: Parameters<typeof clientIp>[0]) => clientIp(c, deps.trustProxy ?? 0);

  // Credential endpoints get a tight per-address budget on top of Better
  // Auth's own rules, so guessing passwords or mass sign-ups stay slow.
  const SENSITIVE = /\/auth\/(sign-in|sign-up|forget-password|request-password-reset|reset-password|change-password)/;
  const authLimit = rateLimit(deps.authAttemptsPer5Min ?? 0, (c) => `auth:${ipOf(c) ?? "anon"}`, 5 * 60_000);
  app.on(["GET", "POST"], "/auth/*", async (c, next) => (c.req.method === "POST" && SENSITIVE.test(c.req.path) ? authLimit(c, next) : next()), (c) => {
    // Hand Better Auth the address we resolved, never one the client sent.
    const headers = new Headers(c.req.raw.headers);
    headers.delete(CLIENT_IP_HEADER);
    const ip = ipOf(c);
    if (ip) headers.set(CLIENT_IP_HEADER, ip);
    return auth.handler(new Request(c.req.raw, { headers }));
  });

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
          kind: user.kind,
        })
        .from(apiToken)
        .innerJoin(user, eq(user.id, apiToken.userId))
        .where(and(eq(apiToken.tokenHash, hashToken(token)), isNull(apiToken.revokedAt)));
      if (!row || (row.expiresAt && row.expiresAt < new Date())) throw unauthorized();
      // Read-only tokens cannot change anything.
      // (The MCP endpoint is a POST for reads too; its tools check again.)
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && !row.scopes.includes("write") && c.req.path !== "/api/mcp") throw forbidden();
      c.set("user", { id: row.userId, name: row.name, email: row.email, kind: row.kind === "agent" ? "agent" : "human" });
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

  app.use("*", rateLimit(deps.rateLimitPerMinute ?? 0, (c) => c.get("user")?.id ?? ipOf(c)));

  app.get("/health", (c) => c.json({ ok: true, edition, version: VERSION, features: editionFeatures(edition) }));
  app.get("/me", (c) => c.json({ user: requireUser(c) }));
  app.get("/me/preferences", async (c) => {
    const u = requireUser(c);
    const [p] = await db.select().from(userPreference).where(eq(userPreference.userId, u.id));
    return c.json({ preferences: { locale: p?.locale ?? "en", emailDigest: p?.emailDigest ?? true } });
  });
  app.patch("/me/preferences", async (c) => {
    const u = requireUser(c);
    const input = await parseBody(c, z.object({ locale: z.enum(["ar", "en"]).optional(), emailDigest: z.boolean().optional() }));
    await db
      .insert(userPreference)
      .values({ userId: u.id, ...input })
      .onConflictDoUpdate({ target: userPreference.userId, set: input });
    return c.json({ ok: true });
  });
  app.get("/openapi.json", (c) => c.json(openApiDocument(deps.baseUrl)));

  app.route("/", workspaceRoutes(deps));
  app.route("/", projectRoutes(deps));
  app.route("/", issueRoutes(deps));
  app.route("/", planningRoutes(deps));
  app.route("/", devlinkRoutes(deps));
  app.route("/", pageRoutes(deps));
  app.route("/", extendRoutes(deps));
  app.route("/", agentRoutes(deps));
  app.route("/", aiRoutes(deps));
  mountMcp(app, { db, baseUrl: deps.baseUrl, version: VERSION });

  return app;
}
