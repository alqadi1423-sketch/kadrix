import {
  DEFAULT_STATES,
  createProjectSchema,
  createStateSchema,
  labelSchema,
  updateProjectSchema,
  updateStateSchema,
} from "@kadrix/core";
import { issue, label, project, workflowState } from "@kadrix/db";
import { messages } from "@kadrix/i18n";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { recordAudit } from "../audit.js";
import { type AppDeps, type Env, type Membership, parseBody, requireUser, seesProject, workspaceGuard } from "../context.js";
import { ApiError, invalid, notFound } from "../errors.js";

/** Picks the request language for data created on the user's behalf. */
export function requestLocale(c: Context): "ar" | "en" {
  const h = c.req.header("x-kadrix-locale") ?? c.req.header("accept-language") ?? "";
  return h.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function projectRoutes({ db, events }: AppDeps) {
  const app = new Hono<Env>();
  const guard = (a: Parameters<typeof workspaceGuard>[1]) => workspaceGuard(db, a);
  const publish = (workspaceId: string, entity: string, id?: string) =>
    events.publish({ workspaceId, entity, id }).catch(() => {});

  async function loadProject(m: Membership, projectId: string) {
    const [p] = await db
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.workspaceId, m.workspaceId)));
    if (!p || !seesProject(m, p.id)) throw notFound();
    return p;
  }

  /* ----------------------------- projects ----------------------------- */

  app.get("/workspaces/:slug/projects", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const includeArchived = c.req.query("archived") === "1";
    const rows = await db
      .select()
      .from(project)
      .where(
        and(
          eq(project.workspaceId, m.workspaceId),
          includeArchived ? undefined : isNull(project.archivedAt),
          m.projectIds ? (m.projectIds.length ? inArray(project.id, m.projectIds) : sql`false`) : undefined,
        ),
      )
      .orderBy(asc(project.name));
    return c.json({ projects: rows });
  });

  app.post("/workspaces/:slug/projects", guard("project.create"), async (c) => {
    const m = c.get("membership");
    const u = requireUser(c);
    const input = await parseBody(c, createProjectSchema);
    const t = messages[requestLocale(c)].states;
    const created = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(project)
        .values({ workspaceId: m.workspaceId, name: input.name, key: input.key, description: input.description })
        .onConflictDoNothing()
        .returning();
      if (!p) throw new ApiError(409, "keyTaken");
      await tx.insert(workflowState).values(
        DEFAULT_STATES.map((s, i) => ({
          workspaceId: m.workspaceId,
          projectId: p.id,
          name: t[s.key as keyof typeof t],
          category: s.category,
          color: s.color,
          position: i,
        })),
      );
      await recordAudit(tx, {
        workspaceId: m.workspaceId,
        actorId: u.id,
        action: "project.created",
        targetType: "project",
        targetId: p.id,
        data: { name: p.name },
      });
      return p;
    });
    await publish(m.workspaceId, "project", created.id);
    return c.json({ project: created }, 201);
  });

  app.get("/workspaces/:slug/projects/:projectId", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const p = await loadProject(m, c.req.param("projectId"));
    const states = await db
      .select()
      .from(workflowState)
      .where(eq(workflowState.projectId, p.id))
      .orderBy(asc(workflowState.position));
    return c.json({ project: p, states });
  });

  app.patch("/workspaces/:slug/projects/:projectId", guard("project.update"), async (c) => {
    const m = c.get("membership");
    const p = await loadProject(m, c.req.param("projectId"));
    const input = await parseBody(c, updateProjectSchema);
    const { archived, ...rest } = input;
    const [row] = await db
      .update(project)
      .set({ ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) })
      .where(eq(project.id, p.id))
      .returning();
    await publish(m.workspaceId, "project", p.id);
    return c.json({ project: row });
  });

  app.delete("/workspaces/:slug/projects/:projectId", guard("project.delete"), async (c) => {
    const m = c.get("membership");
    const p = await loadProject(m, c.req.param("projectId"));
    await db.transaction(async (tx) => {
      await tx.delete(project).where(eq(project.id, p.id));
      await recordAudit(tx, {
        workspaceId: m.workspaceId,
        actorId: requireUser(c).id,
        action: "project.deleted",
        targetType: "project",
        targetId: p.id,
        data: { name: p.name },
      });
    });
    await publish(m.workspaceId, "project", p.id);
    return c.json({ ok: true });
  });

  /* ------------------------------ states ------------------------------ */

  app.post("/workspaces/:slug/projects/:projectId/states", guard("workflow.manage"), async (c) => {
    const m = c.get("membership");
    const p = await loadProject(m, c.req.param("projectId"));
    const input = await parseBody(c, createStateSchema);
    const [max] = await db
      .select({ v: sql<number>`coalesce(max(${workflowState.position}), 0)` })
      .from(workflowState)
      .where(eq(workflowState.projectId, p.id));
    const [row] = await db
      .insert(workflowState)
      .values({ ...input, workspaceId: m.workspaceId, projectId: p.id, position: Number(max?.v ?? 0) + 1 })
      .returning();
    await publish(m.workspaceId, "project", p.id);
    return c.json({ state: row }, 201);
  });

  app.patch("/workspaces/:slug/projects/:projectId/states/:stateId", guard("workflow.manage"), async (c) => {
    const m = c.get("membership");
    const p = await loadProject(m, c.req.param("projectId"));
    const input = await parseBody(c, updateStateSchema);
    const [row] = await db
      .update(workflowState)
      .set(input)
      .where(and(eq(workflowState.id, c.req.param("stateId")), eq(workflowState.projectId, p.id)))
      .returning();
    if (!row) throw notFound();
    await publish(m.workspaceId, "project", p.id);
    return c.json({ state: row });
  });

  /** Deleting a state moves its issues to `moveTo` (required if any exist). */
  app.delete("/workspaces/:slug/projects/:projectId/states/:stateId", guard("workflow.manage"), async (c) => {
    const m = c.get("membership");
    const p = await loadProject(m, c.req.param("projectId"));
    const stateId = c.req.param("stateId");
    const moveTo = c.req.query("moveTo");
    await db.transaction(async (tx) => {
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(issue).where(eq(issue.stateId, stateId));
      const [{ total } = { total: 0 }] = await tx
        .select({ total: count() })
        .from(workflowState)
        .where(eq(workflowState.projectId, p.id));
      if (total <= 1) throw invalid();
      if (n > 0) {
        if (!moveTo || moveTo === stateId) throw invalid();
        const [target] = await tx
          .select()
          .from(workflowState)
          .where(and(eq(workflowState.id, moveTo), eq(workflowState.projectId, p.id)));
        if (!target) throw invalid();
        await tx.update(issue).set({ stateId: moveTo }).where(eq(issue.stateId, stateId));
      }
      const del = await tx
        .delete(workflowState)
        .where(and(eq(workflowState.id, stateId), eq(workflowState.projectId, p.id)))
        .returning();
      if (del.length === 0) throw notFound();
    });
    await publish(m.workspaceId, "project", p.id);
    return c.json({ ok: true });
  });

  /* ------------------------------ labels ------------------------------ */

  app.get("/workspaces/:slug/labels", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const rows = await db.select().from(label).where(eq(label.workspaceId, m.workspaceId)).orderBy(asc(label.name));
    return c.json({ labels: rows });
  });

  app.post("/workspaces/:slug/labels", guard("label.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, labelSchema);
    const [row] = await db
      .insert(label)
      .values({ ...input, workspaceId: m.workspaceId })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ApiError(409, "nameTaken");
    await publish(m.workspaceId, "label");
    return c.json({ label: row }, 201);
  });

  app.patch("/workspaces/:slug/labels/:labelId", guard("label.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, labelSchema.partial());
    const [row] = await db
      .update(label)
      .set(input)
      .where(and(eq(label.id, c.req.param("labelId")), eq(label.workspaceId, m.workspaceId)))
      .returning();
    if (!row) throw notFound();
    await publish(m.workspaceId, "label");
    return c.json({ label: row });
  });

  app.delete("/workspaces/:slug/labels/:labelId", guard("label.manage"), async (c) => {
    const m = c.get("membership");
    const del = await db
      .delete(label)
      .where(and(eq(label.id, c.req.param("labelId")), eq(label.workspaceId, m.workspaceId)))
      .returning();
    if (del.length === 0) throw notFound();
    await publish(m.workspaceId, "label");
    return c.json({ ok: true });
  });

  return app;
}
