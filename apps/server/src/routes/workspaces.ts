import {
  DEFAULT_WEEKEND_AR,
  DEFAULT_WEEKEND_EN,
  addMemberSchema,
  canManageRole,
  createWorkspaceSchema,
  updateMemberRoleSchema,
  weekendSchema,
} from "@veloq/core";
import { auditLog, project, projectAccess, user, workspace, workspaceMember } from "@veloq/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { type AppDeps, type Env, type Tx, parseBody, requireUser, workspaceGuard } from "../context.js";
import { ApiError, forbidden, notFound } from "../errors.js";
import { requestLocale } from "./projects.js";

export function workspaceRoutes({ db }: AppDeps) {
  const app = new Hono<Env>();
  const guard = (a: Parameters<typeof workspaceGuard>[1]) => workspaceGuard(db, a);

  app.get("/workspaces", async (c) => {
    const u = requireUser(c);
    const rows = await db
      .select({ id: workspace.id, slug: workspace.slug, name: workspace.name, role: workspaceMember.role })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(eq(workspaceMember.userId, u.id))
      .orderBy(workspace.name);
    // A token only ever sees the workspace it was created in.
    const only = c.get("tokenWorkspaceId");
    return c.json({ workspaces: only ? rows.filter((r) => r.id === only) : rows });
  });

  app.post("/workspaces", async (c) => {
    const u = requireUser(c);
    if (c.get("tokenWorkspaceId")) throw forbidden();
    const input = await parseBody(c, createWorkspaceSchema);
    const weekendDays = requestLocale(c) === "ar" ? DEFAULT_WEEKEND_AR : DEFAULT_WEEKEND_EN;
    const created = await db.transaction(async (tx) => {
      const [ws] = await tx
        .insert(workspace)
        .values({ ...input, weekendDays })
        .onConflictDoNothing({ target: workspace.slug })
        .returning();
      if (!ws) throw new ApiError(409, "slugTaken");
      await tx.insert(workspaceMember).values({ workspaceId: ws.id, userId: u.id, role: "owner" });
      await recordAudit(tx, { workspaceId: ws.id, actorId: u.id, action: "workspace.created" });
      return ws;
    });
    return c.json({ workspace: { ...created, role: "owner" as const } }, 201);
  });

  app.get("/workspaces/:slug", guard("workspace.read"), async (c) => {
    const m = c.get("membership");
    const [w] = await db.select({ weekendDays: workspace.weekendDays }).from(workspace).where(eq(workspace.id, m.workspaceId));
    return c.json({ workspace: { ...m, weekendDays: w?.weekendDays ?? [] } });
  });

  app.patch("/workspaces/:slug", guard("workspace.update"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(
      c,
      z.object({ name: z.string().trim().min(1).max(80).optional(), weekendDays: weekendSchema.optional() }),
    );
    if (input.weekendDays) input.weekendDays = [...new Set(input.weekendDays)].sort();
    await db.update(workspace).set(input).where(eq(workspace.id, m.workspaceId));
    if (input.name) {
      await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "workspace.renamed", data: { name: input.name } });
    }
    return c.json({ ok: true });
  });

  app.delete("/workspaces/:slug", guard("workspace.delete"), async (c) => {
    const m = c.get("membership");
    const { confirm } = await parseBody(c, z.object({ confirm: z.string() }));
    if (confirm !== m.slug) throw new ApiError(400, "invalid");
    await db.delete(workspace).where(eq(workspace.id, m.workspaceId));
    return c.json({ ok: true });
  });

  app.get("/workspaces/:slug/members", guard("member.read"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        kind: user.kind,
        role: workspaceMember.role,
        projectIds: sql<string[] | null>`case when ${workspaceMember.role} = 'guest' then coalesce((select array_agg(pa.project_id) from ${projectAccess} pa join ${project} p on p.id = pa.project_id where pa.user_id = ${user.id} and p.workspace_id = ${m.workspaceId}), '{}') end`,
      })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(eq(workspaceMember.workspaceId, m.workspaceId))
      .orderBy(user.name);
    return c.json({ members: rows });
  });

  app.post("/workspaces/:slug/members", guard("member.invite"), async (c) => {
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

  app.patch("/workspaces/:slug/members/:userId", guard("member.updateRole"), async (c) => {
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

  app.delete("/workspaces/:slug/members/:userId", guard("member.remove"), async (c) => {
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

  /** Which projects a guest can see. Replaces the whole list. */
  app.put("/workspaces/:slug/members/:userId/projects", guard("member.updateRole"), async (c) => {
    const m = c.get("membership");
    const { projectIds } = await parseBody(c, z.object({ projectIds: z.array(z.string().uuid()).max(200) }));
    const userId = c.req.param("userId");
    const [target] = await db
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, m.workspaceId), eq(workspaceMember.userId, userId)));
    if (!target) throw notFound();
    if (target.role !== "guest") throw new ApiError(400, "invalid");
    const valid = projectIds.length
      ? await db
          .select({ id: project.id })
          .from(project)
          .where(and(eq(project.workspaceId, m.workspaceId), inArray(project.id, projectIds)))
      : [];
    if (valid.length !== new Set(projectIds).size) throw new ApiError(400, "invalid");
    await db.transaction(async (tx) => {
      const mine = await tx.select({ id: project.id }).from(project).where(eq(project.workspaceId, m.workspaceId));
      if (mine.length) {
        await tx
          .delete(projectAccess)
          .where(and(eq(projectAccess.userId, userId), inArray(projectAccess.projectId, mine.map((x) => x.id))));
      }
      if (projectIds.length) {
        await tx.insert(projectAccess).values([...new Set(projectIds)].map((projectId) => ({ projectId, userId })));
      }
      await recordAudit(tx, {
        workspaceId: m.workspaceId,
        actorId: requireUser(c).id,
        action: "member.projectsChanged",
        targetType: "user",
        targetId: userId,
        data: { count: projectIds.length },
      });
    });
    return c.json({ ok: true });
  });

  app.get("/workspaces/:slug/audit", guard("audit.read"), async (c) => {
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
