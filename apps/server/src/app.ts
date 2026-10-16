import {
  addMemberSchema,
  can,
  canManageRole,
  createWorkspaceSchema,
  updateMemberRoleSchema,
  type Action,
  type Edition,
  type Role,
} from "@veloq/core";
import { auditLog, user, workspace, workspaceMember, type Database } from "@veloq/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { Auth } from "./auth.js";
import { recordAudit } from "./audit.js";
import { ApiError, forbidden, invalid, notFound, unauthorized } from "./errors.js";

type SessionUser = { id: string; name: string; email: string };
type Membership = { workspaceId: string; slug: string; name: string; role: Role };

type Env = {
  Variables: {
    user: SessionUser | null;
    membership: Membership;
  };
};

export interface AppDeps {
  db: Database;
  auth: Auth;
  edition: Edition;
}

async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => null);
  const result = schema.safeParse(body);
  if (!result.success) throw invalid();
  return result.data;
}

export function createApp({ db, auth, edition }: AppDeps) {
  const app = new Hono<Env>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.code }, err.status);
    console.error(err);
    return c.json({ error: "generic" }, 500);
  });

  app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

  // Resolve the session once per request.
  app.use("*", async (c, next) => {
    const s = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", s ? { id: s.user.id, name: s.user.name, email: s.user.email } : null);
    await next();
  });

  const requireUser = (c: Context<Env>) => {
    const u = c.get("user");
    if (!u) throw unauthorized();
    return u;
  };

  /**
   * Loads the caller's membership in `:slug` and checks `action`.
   * Non-members get 404, not 403, so workspace existence is not leaked.
   */
  const workspaceGuard =
    (action: Action): MiddlewareHandler<Env> =>
    async (c, next) => {
      const u = requireUser(c);
      const slug = c.req.param("slug") ?? "";
      const [row] = await db
        .select({
          workspaceId: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
          role: workspaceMember.role,
        })
        .from(workspace)
        .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
        .where(and(eq(workspace.slug, slug), eq(workspaceMember.userId, u.id)))
        .limit(1);
      if (!row) throw notFound();
      if (!can(row.role, action)) throw forbidden();
      c.set("membership", row);
      await next();
    };

  app.get("/health", (c) => c.json({ ok: true, edition }));

  app.get("/me", (c) => c.json({ user: requireUser(c) }));

  app.get("/workspaces", async (c) => {
    const u = requireUser(c);
    const rows = await db
      .select({ id: workspace.id, slug: workspace.slug, name: workspace.name, role: workspaceMember.role })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(eq(workspaceMember.userId, u.id))
      .orderBy(workspace.name);
    return c.json({ workspaces: rows });
  });

  app.post("/workspaces", async (c) => {
    const u = requireUser(c);
    const input = await parseBody(c, createWorkspaceSchema);
    const created = await db.transaction(async (tx) => {
      const [ws] = await tx
        .insert(workspace)
        .values(input)
        .onConflictDoNothing({ target: workspace.slug })
        .returning();
      if (!ws) throw new ApiError(409, "slugTaken");
      await tx.insert(workspaceMember).values({ workspaceId: ws.id, userId: u.id, role: "owner" });
      await recordAudit(tx, { workspaceId: ws.id, actorId: u.id, action: "workspace.created" });
      return ws;
    });
    return c.json({ workspace: { ...created, role: "owner" as const } }, 201);
  });

  app.get("/workspaces/:slug", workspaceGuard("workspace.read"), (c) =>
    c.json({ workspace: c.get("membership") }),
  );

  app.get("/workspaces/:slug/members", workspaceGuard("member.read"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({ userId: user.id, name: user.name, email: user.email, role: workspaceMember.role })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(eq(workspaceMember.workspaceId, m.workspaceId))
      .orderBy(user.name);
    return c.json({ members: rows });
  });

  app.post("/workspaces/:slug/members", workspaceGuard("member.invite"), async (c) => {
    const actor = requireUser(c);
    const m = c.get("membership");
    const input = await parseBody(c, addMemberSchema);
    if (!canManageRole(m.role, null, input.role)) throw forbidden();
    const [target] = await db.select().from(user).where(eq(user.email, input.email)).limit(1);
    if (!target) throw new ApiError(404, "userNotFound");
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(workspaceMember)
        .values({ workspaceId: m.workspaceId, userId: target.id, role: input.role })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) throw new ApiError(409, "alreadyMember");
      await recordAudit(tx, {
        workspaceId: m.workspaceId,
        actorId: actor.id,
        action: "member.added",
        targetType: "user",
        targetId: target.id,
        data: { role: input.role, targetName: target.name },
      });
    });
    return c.json({ ok: true }, 201);
  });

  app.patch("/workspaces/:slug/members/:userId", workspaceGuard("member.updateRole"), async (c) => {
    const actor = requireUser(c);
    const m = c.get("membership");
    const { role } = await parseBody(c, updateMemberRoleSchema);
    await db.transaction(async (tx) => {
      const current = await lockMember(tx, m.workspaceId, c.req.param("userId"));
      if (!canManageRole(m.role, current.role, role)) throw forbidden();
      if (current.role === "owner" && role !== "owner") await assertAnotherOwner(tx, m.workspaceId);
      await tx
        .update(workspaceMember)
        .set({ role })
        .where(and(eq(workspaceMember.workspaceId, m.workspaceId), eq(workspaceMember.userId, current.userId)));
      await recordAudit(tx, {
        workspaceId: m.workspaceId,
        actorId: actor.id,
        action: "member.roleChanged",
        targetType: "user",
        targetId: current.userId,
        data: { from: current.role, role, targetName: current.name },
      });
    });
    return c.json({ ok: true });
  });

  app.delete("/workspaces/:slug/members/:userId", workspaceGuard("member.remove"), async (c) => {
    const actor = requireUser(c);
    const m = c.get("membership");
    await db.transaction(async (tx) => {
      const current = await lockMember(tx, m.workspaceId, c.req.param("userId"));
      // Removing someone is managing their role; same rank rules apply.
      if (!canManageRole(m.role, current.role, "guest")) throw forbidden();
      if (current.role === "owner") await assertAnotherOwner(tx, m.workspaceId);
      await tx
        .delete(workspaceMember)
        .where(and(eq(workspaceMember.workspaceId, m.workspaceId), eq(workspaceMember.userId, current.userId)));
      await recordAudit(tx, {
        workspaceId: m.workspaceId,
        actorId: actor.id,
        action: "member.removed",
        targetType: "user",
        targetId: current.userId,
        data: { targetName: current.name },
      });
    });
    return c.json({ ok: true });
  });

  app.get("/workspaces/:slug/audit", workspaceGuard("audit.read"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        data: auditLog.data,
        createdAt: auditLog.createdAt,
        actorName: user.name,
      })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorId))
      .where(eq(auditLog.workspaceId, m.workspaceId))
      .orderBy(desc(auditLog.createdAt))
      .limit(100);
    return c.json({ entries: rows });
  });

  return app;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function lockMember(tx: Tx, workspaceId: string, userId: string) {
  const [row] = await tx
    .select({ userId: workspaceMember.userId, role: workspaceMember.role, name: user.name })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
    .for("update", { of: workspaceMember })
    .limit(1);
  if (!row) throw notFound();
  return row;
}

async function assertAnotherOwner(tx: Tx, workspaceId: string) {
  // Lock all owner rows so two concurrent demotions cannot both pass.
  const owners = await tx
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, "owner")))
    .for("update");
  if (owners.length < 2) throw new ApiError(409, "lastOwner");
}
