import { can, type Action, type AiProvider, type Edition, type Role } from "@veloq/core";
import { projectAccess, workspace, workspaceMember, type Database } from "@veloq/db";
import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { Auth } from "./auth.js";
import { forbidden, invalid, notFound, unauthorized } from "./errors.js";
import type { Sealer } from "./crypto.js";
import type { EventBus } from "./events.js";
import type { Storage } from "./storage.js";

export type SessionUser = { id: string; name: string; email: string; kind?: "human" | "agent" };
/**
 * `projectIds` is null for full members. For guests it lists the only
 * projects they may see; every project-scoped query must respect it.
 */
export type Membership = { workspaceId: string; slug: string; name: string; role: Role; projectIds: string[] | null };

export type Env = {
  Variables: {
    user: SessionUser | null;
    /** Set when the request authenticated with an API token. */
    tokenWorkspaceId: string | null;
    tokenScopes: string[] | null;
    membership: Membership;
  };
};

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Db = Database | Tx;

export interface AppDeps {
  db: Database;
  auth: Auth;
  edition: Edition;
  events: EventBus;
  storage: Storage;
  baseUrl: string;
  /** Encrypts webhook and integration secrets at rest. */
  sealer: Sealer;
  /** Allow webhooks to private/internal addresses (self-hosted intranets). */
  allowPrivateWebhooks: boolean;
  /** Requests per minute per user or IP; 0 disables the limiter. */
  rateLimitPerMinute?: number;
  /** Sign-in, sign-up and reset attempts per client address per 5 minutes (0 = off). */
  authAttemptsPer5Min?: number;
  /** Reverse proxies in front of the server whose X-Forwarded-For we trust. */
  trustProxy?: number;
  /** Override for outgoing webhook HTTP calls (tests). */
  webhookFetch?: typeof fetch;
  /** Override for calls to other tools' APIs when importing (tests). */
  importFetch?: typeof fetch;
  /** AI provider, or null/undefined while none is switched on. */
  ai?: AiProvider | null;
}

export function requireUser(c: Context<Env>): SessionUser {
  const u = c.get("user");
  if (!u) throw unauthorized();
  return u;
}

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => null);
  const result = schema.safeParse(body);
  if (!result.success) throw invalid();
  return result.data;
}

export function parseQuery<T extends z.ZodType>(value: unknown, schema: T): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

/**
 * Loads the caller's membership in `:slug` and checks `action`.
 * Non-members get 404, not 403, so workspace existence is not leaked.
 * API tokens are bound to one workspace and cannot reach any other.
 */
export const workspaceGuard =
  (db: Database, action: Action): MiddlewareHandler<Env> =>
  async (c, next) => {
    const u = requireUser(c);
    const slug = c.req.param("slug") ?? "";
    const [row] = await db
      .select({ workspaceId: workspace.id, slug: workspace.slug, name: workspace.name, role: workspaceMember.role })
      .from(workspace)
      .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
      .where(and(eq(workspace.slug, slug), eq(workspaceMember.userId, u.id)))
      .limit(1);
    if (!row) throw notFound();
    const tokenWs = c.get("tokenWorkspaceId");
    if (tokenWs && tokenWs !== row.workspaceId) throw notFound();
    if (!can(row.role, action)) throw forbidden();
    let projectIds: string[] | null = null;
    if (row.role === "guest") {
      const rows = await db
        .select({ id: projectAccess.projectId })
        .from(projectAccess)
        .where(eq(projectAccess.userId, u.id));
      projectIds = rows.map((r) => r.id);
    }
    c.set("membership", { ...row, projectIds });
    await next();
  };

/** In-handler permission check for actions that depend on the request body. */
export function assertCan(c: Context<Env>, action: Action) {
  if (!can(c.get("membership").role, action)) throw forbidden();
}

/** True when the membership may see this project. */
export function seesProject(m: Pick<Membership, "projectIds">, projectId: string | null | undefined): boolean {
  if (m.projectIds === null) return true;
  return !!projectId && m.projectIds.includes(projectId);
}
