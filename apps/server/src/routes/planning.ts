import {
  CLOSED_CATEGORIES,
  burndown,
  createCycleSchema,
  criticalPath,
  formatDate,
  initiativeSchema,
  milestoneSchema,
  statusUpdateSchema,
  updateCycleSchema,
  velocity,
  workingDaysBetween,
  type BurnIssue,
} from "@kadrix/core";
import {
  cycle,
  initiative,
  initiativeProject,
  issue,
  issueActivity,
  issueRelation,
  milestone,
  project,
  statusUpdate,
  user,
  workflowState,
  workspace,
} from "@kadrix/db";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppDeps, type Env, type Membership, parseBody, requireUser, seesProject, workspaceGuard } from "../context.js";
import { invalid, notFound } from "../errors.js";
import { updateIssue } from "../services/issues.js";
import { listIssues } from "../services/query.js";

export function planningRoutes(deps: AppDeps) {
  const { db, events } = deps;
  const app = new Hono<Env>();
  const guard = (a: Parameters<typeof workspaceGuard>[1]) => workspaceGuard(db, a);
  const publish = (workspaceId: string, entity: string, id?: string) =>
    events.publish({ workspaceId, entity, id }).catch(() => {});

  async function projectIn(m: Membership, projectId: string) {
    const [p] = await db
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.workspaceId, m.workspaceId)));
    if (!p || !seesProject(m, p.id)) throw notFound();
    return p;
  }
  async function weekendOf(workspaceId: string) {
    const [w] = await db.select({ d: workspace.weekendDays }).from(workspace).where(eq(workspace.id, workspaceId));
    return w?.d ?? [5, 6];
  }
  const today = () => formatDate(new Date());

  /* ------------------------------ cycles ------------------------------ */

  async function cycleStats(workspaceId: string, cycleIds: string[]) {
    if (cycleIds.length === 0) return new Map<string, { total: number; done: number; points: number; donePoints: number }>();
    const rows = await db
      .select({
        cycleId: issue.cycleId,
        category: workflowState.category,
        n: count(),
        points: sql<number>`coalesce(sum(${issue.estimate}), 0)`,
      })
      .from(issue)
      .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
      .where(and(eq(issue.workspaceId, workspaceId), inArray(issue.cycleId, cycleIds)))
      .groupBy(issue.cycleId, workflowState.category);
    const out = new Map<string, { total: number; done: number; points: number; donePoints: number }>();
    for (const r of rows) {
      const s = out.get(r.cycleId!) ?? { total: 0, done: 0, points: 0, donePoints: 0 };
      if (r.category === "canceled") continue;
      s.total += r.n;
      s.points += Number(r.points);
      if (r.category === "completed") {
        s.done += r.n;
        s.donePoints += Number(r.points);
      }
      out.set(r.cycleId!, s);
    }
    return out;
  }

  app.get("/workspaces/:slug/projects/:projectId/cycles", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const p = await projectIn(m, c.req.param("projectId"));
    const rows = await db.select().from(cycle).where(eq(cycle.projectId, p.id)).orderBy(asc(cycle.startsOn));
    const stats = await cycleStats(m.workspaceId, rows.map((r) => r.id));
    const t = today();
    const delivered = rows.filter((r) => r.completedAt).map((r) => stats.get(r.id)?.donePoints ?? 0);
    return c.json({
      cycles: rows.map((r) => ({
        ...r,
        status: r.completedAt ? "completed" : r.startsOn > t ? "upcoming" : r.endsOn < t ? "overdue" : "active",
        ...(stats.get(r.id) ?? { total: 0, done: 0, points: 0, donePoints: 0 }),
      })),
      velocity: velocity(delivered),
    });
  });

  app.post("/workspaces/:slug/projects/:projectId/cycles", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const p = await projectIn(m, c.req.param("projectId"));
    const input = await parseBody(c, createCycleSchema);
    const created = await db.transaction(async (tx) => {
      // Lock the project row so cycle numbers are handed out one at a time.
      await tx.select({ id: project.id }).from(project).where(eq(project.id, p.id)).for("update");
      const overlap = await tx
        .select({ id: cycle.id })
        .from(cycle)
        .where(and(eq(cycle.projectId, p.id), sql`${cycle.startsOn} <= ${input.endsOn}`, sql`${cycle.endsOn} >= ${input.startsOn}`));
      if (overlap.length) throw invalid();
      const [{ max } = { max: 0 }] = await tx
        .select({ max: sql<number>`coalesce(max(${cycle.number}), 0)` })
        .from(cycle)
        .where(eq(cycle.projectId, p.id));
      const [row] = await tx
        .insert(cycle)
        .values({ workspaceId: m.workspaceId, projectId: p.id, number: Number(max) + 1, ...input })
        .returning();
      return row!;
    });
    await publish(m.workspaceId, "cycle", created.id);
    return c.json({ cycle: created }, 201);
  });

  app.patch("/workspaces/:slug/cycles/:cycleId", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, updateCycleSchema);
    const [row] = await db
      .update(cycle)
      .set(input)
      .where(and(eq(cycle.id, c.req.param("cycleId")), eq(cycle.workspaceId, m.workspaceId)))
      .returning();
    if (!row) throw notFound();
    if (row.endsOn < row.startsOn) throw invalid();
    await publish(m.workspaceId, "cycle", row.id);
    return c.json({ cycle: row });
  });

  app.delete("/workspaces/:slug/cycles/:cycleId", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const del = await db
      .delete(cycle)
      .where(and(eq(cycle.id, c.req.param("cycleId")), eq(cycle.workspaceId, m.workspaceId)))
      .returning();
    if (!del.length) throw notFound();
    await publish(m.workspaceId, "cycle");
    return c.json({ ok: true });
  });

  /**
   * Closes a cycle. Unfinished issues roll over to `moveTo`, or to the next
   * upcoming cycle of the project, or leave the cycle when there is none.
   */
  app.post("/workspaces/:slug/cycles/:cycleId/complete", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const { moveTo } = await parseBody(c, z.object({ moveTo: z.string().uuid().nullable().optional() }));
    const [cur] = await db
      .select()
      .from(cycle)
      .where(and(eq(cycle.id, c.req.param("cycleId")), eq(cycle.workspaceId, m.workspaceId)));
    if (!cur) throw notFound();
    if (cur.completedAt) throw invalid();
    let target: string | null = null;
    if (moveTo) {
      const [x] = await db
        .select()
        .from(cycle)
        .where(and(eq(cycle.id, moveTo), eq(cycle.projectId, cur.projectId), isNull(cycle.completedAt)));
      if (!x || x.id === cur.id) throw invalid();
      target = x.id;
    } else if (moveTo === undefined) {
      const [next] = await db
        .select()
        .from(cycle)
        .where(and(eq(cycle.projectId, cur.projectId), isNull(cycle.completedAt), gt(cycle.startsOn, cur.startsOn)))
        .orderBy(asc(cycle.startsOn))
        .limit(1);
      target = next?.id ?? null;
    }
    const open = await db
      .select({ id: issue.id })
      .from(issue)
      .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
      .where(and(eq(issue.cycleId, cur.id), notInArray(workflowState.category, [...CLOSED_CATEGORIES])));
    const ctx = { db, events, workspaceId: m.workspaceId, actorId: requireUser(c).id };
    for (const i of open) await updateIssue(ctx, i.id, { cycleId: target });
    await db.update(cycle).set({ completedAt: new Date() }).where(eq(cycle.id, cur.id));
    await publish(m.workspaceId, "cycle", cur.id);
    return c.json({ rolledOver: open.length, movedTo: target });
  });

  /** Burndown series (points when estimates exist, otherwise issue count). */
  app.get("/workspaces/:slug/cycles/:cycleId/burndown", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const [cur] = await db
      .select()
      .from(cycle)
      .where(and(eq(cycle.id, c.req.param("cycleId")), eq(cycle.workspaceId, m.workspaceId)));
    if (!cur || !seesProject(m, cur.projectId)) throw notFound();
    const rows = await db
      .select({
        id: issue.id,
        estimate: issue.estimate,
        createdAt: issue.createdAt,
        completedAt: issue.completedAt,
        canceledAt: issue.canceledAt,
      })
      .from(issue)
      .where(eq(issue.cycleId, cur.id));
    const joins = rows.length
      ? await db
          .select({ issueId: issueActivity.issueId, at: sql<string>`max(${issueActivity.createdAt})` })
          .from(issueActivity)
          .where(
            and(
              inArray(issueActivity.issueId, rows.map((r) => r.id)),
              eq(issueActivity.field, "cycleId"),
              sql`${issueActivity.toValue} = to_jsonb(${cur.id}::text)`,
            ),
          )
          .groupBy(issueActivity.issueId)
      : [];
    const joinedAt = new Map(joins.map((j) => [j.issueId, formatDate(new Date(j.at))]));
    const usePoints = rows.some((r) => r.estimate !== null);
    const items: BurnIssue[] = rows.map((r) => {
      const added = joinedAt.get(r.id) ?? formatDate(r.createdAt);
      const closed = r.completedAt ?? r.canceledAt;
      return {
        weight: usePoints ? (r.estimate ?? 0) : 1,
        addedOn: added < cur.startsOn ? cur.startsOn : added,
        closedOn: closed ? formatDate(closed) : null,
      };
    });
    const weekend = await weekendOf(m.workspaceId);
    return c.json({
      unit: usePoints ? "points" : "issues",
      points: burndown(items, cur.startsOn, cur.endsOn, weekend, today()),
      workingDays: workingDaysBetween(cur.startsOn, cur.endsOn, weekend),
    });
  });

  /* ---------------------------- milestones ---------------------------- */

  app.get("/workspaces/:slug/projects/:projectId/milestones", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const p = await projectIn(m, c.req.param("projectId"));
    const rows = await db
      .select({
        id: milestone.id,
        name: milestone.name,
        description: milestone.description,
        targetDate: milestone.targetDate,
        total: sql<number>`(select count(*) from ${issue} i join ${workflowState} s on s.id = i.state_id where i.milestone_id = ${sql.raw('"milestone"."id"')} and s.category <> 'canceled')`,
        done: sql<number>`(select count(*) from ${issue} i join ${workflowState} s on s.id = i.state_id where i.milestone_id = ${sql.raw('"milestone"."id"')} and s.category = 'completed')`,
      })
      .from(milestone)
      .where(eq(milestone.projectId, p.id))
      .orderBy(asc(milestone.targetDate));
    return c.json({ milestones: rows.map((r) => ({ ...r, total: Number(r.total), done: Number(r.done) })) });
  });

  app.post("/workspaces/:slug/projects/:projectId/milestones", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const p = await projectIn(m, c.req.param("projectId"));
    const input = await parseBody(c, milestoneSchema);
    const [row] = await db.insert(milestone).values({ ...input, workspaceId: m.workspaceId, projectId: p.id }).returning();
    await publish(m.workspaceId, "milestone", row!.id);
    return c.json({ milestone: row }, 201);
  });

  app.patch("/workspaces/:slug/milestones/:id", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, milestoneSchema.partial());
    const [row] = await db
      .update(milestone)
      .set(input)
      .where(and(eq(milestone.id, c.req.param("id")), eq(milestone.workspaceId, m.workspaceId)))
      .returning();
    if (!row) throw notFound();
    await publish(m.workspaceId, "milestone", row.id);
    return c.json({ milestone: row });
  });

  app.delete("/workspaces/:slug/milestones/:id", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const del = await db
      .delete(milestone)
      .where(and(eq(milestone.id, c.req.param("id")), eq(milestone.workspaceId, m.workspaceId)))
      .returning();
    if (!del.length) throw notFound();
    await publish(m.workspaceId, "milestone");
    return c.json({ ok: true });
  });

  /* ----------------------------- timeline ----------------------------- */

  /**
   * Issues with dates, the "blocks" dependencies between them, milestones,
   * and the critical path computed in working days.
   */
  app.get("/workspaces/:slug/projects/:projectId/timeline", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const p = await projectIn(m, c.req.param("projectId"));
    const weekend = await weekendOf(m.workspaceId);
    const all = await listIssues(db, m, { projectId: p.id, includeClosed: true }, 2000);
    const dated = all.filter((i) => i.startDate || i.dueDate);
    const ids = dated.map((i) => i.id);
    const deps = ids.length
      ? await db
          .select({ from: issueRelation.issueId, to: issueRelation.relatedIssueId })
          .from(issueRelation)
          .where(and(eq(issueRelation.type, "blocks"), inArray(issueRelation.issueId, ids), inArray(issueRelation.relatedIssueId, ids)))
      : [];
    const nodes = dated.map((i) => {
      const start = i.startDate ?? i.dueDate!;
      const end = i.dueDate ?? i.startDate!;
      return { id: i.id, duration: Math.max(1, workingDaysBetween(start, end, weekend)) };
    });
    const cp = criticalPath(nodes, deps);
    const ms = await db.select().from(milestone).where(eq(milestone.projectId, p.id)).orderBy(asc(milestone.targetDate));
    return c.json({
      issues: dated,
      undated: all.filter((i) => !i.startDate && !i.dueDate && !i.completedAt).length,
      dependencies: deps,
      milestones: ms,
      criticalPath: cp.path,
      criticalLength: cp.length,
      weekend,
    });
  });

  /* ---------------------------- initiatives --------------------------- */

  async function initiativeRow(workspaceId: string, id: string) {
    const [row] = await db
      .select()
      .from(initiative)
      .where(and(eq(initiative.id, id), eq(initiative.workspaceId, workspaceId)));
    if (!row) throw notFound();
    return row;
  }

  async function assertProjects(workspaceId: string, ids: string[]) {
    if (!ids.length) return;
    const rows = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.workspaceId, workspaceId), inArray(project.id, ids)));
    if (rows.length !== new Set(ids).size) throw invalid();
  }

  app.get("/workspaces/:slug/initiatives", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    // Guests see counts and project lists only for their own projects.
    const guestOnly = m.projectIds ? sql` and ${m.projectIds.length ? inArray(sql`i.project_id`, m.projectIds) : sql`false`}` : sql``;
    const rows = await db
      .select({
        id: initiative.id,
        name: initiative.name,
        description: initiative.description,
        targetDate: initiative.targetDate,
        ownerName: user.name,
        projectIds: sql<string[]>`coalesce((select array_agg(${initiativeProject.projectId}) from ${initiativeProject} where ${initiativeProject.initiativeId} = ${initiative.id}), '{}')`,
        // Progress rolls up from every issue in the linked projects.
        total: sql<number>`(select count(*) from ${issue} i join ${workflowState} s on s.id = i.state_id join ${initiativeProject} ip on ip.project_id = i.project_id where ip.initiative_id = ${initiative.id} and s.category <> 'canceled'${guestOnly})`,
        done: sql<number>`(select count(*) from ${issue} i join ${workflowState} s on s.id = i.state_id join ${initiativeProject} ip on ip.project_id = i.project_id where ip.initiative_id = ${initiative.id} and s.category = 'completed'${guestOnly})`,
        health: sql<string | null>`(select su.health from ${statusUpdate} su where su.initiative_id = ${initiative.id} order by su.created_at desc limit 1)`,
      })
      .from(initiative)
      .leftJoin(user, eq(user.id, initiative.ownerId))
      .where(
        and(
          eq(initiative.workspaceId, m.workspaceId),
          m.projectIds
            ? sql`exists (select 1 from ${initiativeProject} ip where ip.initiative_id = ${initiative.id} and ${
                m.projectIds.length ? inArray(sql`ip.project_id`, m.projectIds) : sql`false`
              })`
            : undefined,
        ),
      )
      .orderBy(asc(initiative.targetDate), asc(initiative.name));
    return c.json({
      initiatives: rows.map((r) => ({
        ...r,
        projectIds: m.projectIds ? r.projectIds.filter((p) => m.projectIds!.includes(p)) : r.projectIds,
        total: Number(r.total),
        done: Number(r.done),
      })),
    });
  });

  app.post("/workspaces/:slug/initiatives", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const { projectIds = [], ...input } = await parseBody(c, initiativeSchema);
    await assertProjects(m.workspaceId, projectIds);
    const row = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(initiative)
        .values({ ...input, workspaceId: m.workspaceId, ownerId: requireUser(c).id })
        .returning();
      if (projectIds.length) {
        await tx.insert(initiativeProject).values([...new Set(projectIds)].map((projectId) => ({ initiativeId: r!.id, projectId })));
      }
      return r!;
    });
    await publish(m.workspaceId, "initiative", row.id);
    return c.json({ initiative: row }, 201);
  });

  app.patch("/workspaces/:slug/initiatives/:id", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const cur = await initiativeRow(m.workspaceId, c.req.param("id"));
    const { projectIds, ...input } = await parseBody(c, initiativeSchema.partial());
    if (projectIds) await assertProjects(m.workspaceId, projectIds);
    await db.transaction(async (tx) => {
      if (Object.keys(input).length) await tx.update(initiative).set(input).where(eq(initiative.id, cur.id));
      if (projectIds) {
        await tx.delete(initiativeProject).where(eq(initiativeProject.initiativeId, cur.id));
        if (projectIds.length) {
          await tx.insert(initiativeProject).values([...new Set(projectIds)].map((projectId) => ({ initiativeId: cur.id, projectId })));
        }
      }
    });
    await publish(m.workspaceId, "initiative", cur.id);
    return c.json({ ok: true });
  });

  app.delete("/workspaces/:slug/initiatives/:id", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const cur = await initiativeRow(m.workspaceId, c.req.param("id"));
    await db.delete(initiative).where(eq(initiative.id, cur.id));
    await publish(m.workspaceId, "initiative");
    return c.json({ ok: true });
  });

  /** Status updates for an initiative (`initiativeId`) or a project (`projectId`). */
  app.get("/workspaces/:slug/updates", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const initiativeId = c.req.query("initiativeId");
    const projectId = c.req.query("projectId");
    if (!initiativeId && !projectId) throw invalid();
    if (m.projectIds) {
      // Guests read updates only for their projects.
      if (initiativeId || !seesProject(m, projectId)) throw notFound();
    }
    const rows = await db
      .select({
        id: statusUpdate.id,
        health: statusUpdate.health,
        body: statusUpdate.body,
        createdAt: statusUpdate.createdAt,
        authorName: user.name,
      })
      .from(statusUpdate)
      .leftJoin(user, eq(user.id, statusUpdate.authorId))
      .where(
        and(
          eq(statusUpdate.workspaceId, m.workspaceId),
          initiativeId ? eq(statusUpdate.initiativeId, initiativeId) : undefined,
          projectId ? eq(statusUpdate.projectId, projectId) : undefined,
        ),
      )
      .orderBy(desc(statusUpdate.createdAt))
      .limit(50);
    return c.json({ updates: rows });
  });

  app.post("/workspaces/:slug/updates", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(
      c,
      statusUpdateSchema.extend({ initiativeId: z.string().uuid().optional(), projectId: z.string().uuid().optional() }),
    );
    if (!!input.initiativeId === !!input.projectId) throw invalid();
    if (input.initiativeId) await initiativeRow(m.workspaceId, input.initiativeId);
    if (input.projectId) await projectIn(m, input.projectId);
    const [row] = await db
      .insert(statusUpdate)
      .values({ ...input, workspaceId: m.workspaceId, authorId: requireUser(c).id })
      .returning();
    await publish(m.workspaceId, "initiative", input.initiativeId);
    return c.json({ update: row }, 201);
  });

  /* ---------------------------- calendar ------------------------------ */

  /** Issues due in [from, to], across projects (for the calendar view). */
  app.get("/workspaces/:slug/calendar", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const q = z
      .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), projectId: z.string().uuid().optional() })
      .safeParse(c.req.query());
    if (!q.success || q.data.to < q.data.from) throw invalid();
    const items = await listIssues(
      db,
      m,
      { projectId: q.data.projectId, includeClosed: true, dueFrom: q.data.from, dueTo: q.data.to },
      2000,
    );
    const ms = await db
      .select()
      .from(milestone)
      .where(
        and(
          eq(milestone.workspaceId, m.workspaceId),
          isNotNull(milestone.targetDate),
          sql`${milestone.targetDate} between ${q.data.from} and ${q.data.to}`,
          q.data.projectId ? eq(milestone.projectId, q.data.projectId) : undefined,
          m.projectIds ? (m.projectIds.length ? inArray(milestone.projectId, m.projectIds) : sql`false`) : undefined,
        ),
      );
    return c.json({ issues: items, milestones: ms });
  });

  return app;
}

