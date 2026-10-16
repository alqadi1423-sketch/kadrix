import { findIssueKeys } from "@veloq/core";
import { issue, page, pageIssue, project, user, type Database } from "@veloq/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppDeps, type Env, type Membership, parseBody, requireUser, seesProject, workspaceGuard } from "../context.js";
import { invalid, notFound } from "../errors.js";

export const createPageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  projectId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});
export const updatePageSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().uuid().nullable().optional(),
  position: z.number().optional(),
});

/** Guests see project pages of their projects only, never workspace-wide pages. */
function pageScope(m: Membership) {
  if (!m.projectIds) return eq(page.workspaceId, m.workspaceId);
  return and(
    eq(page.workspaceId, m.workspaceId),
    m.projectIds.length ? inArray(page.projectId, m.projectIds) : sql`false`,
  )!;
}

export async function loadPage(db: Database, m: Membership, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound();
  const [row] = await db
    .select()
    .from(page)
    .where(and(eq(page.id, id), pageScope(m)));
  if (!row) throw notFound();
  return row;
}

/** Rebuilds the list of issues a page mentions from its plain text. */
export async function syncPageIssues(db: Database, workspaceId: string, pageId: string, text: string) {
  const keys = findIssueKeys(text).map((k) => k.key);
  await db.transaction(async (tx) => {
    await tx.delete(pageIssue).where(eq(pageIssue.pageId, pageId));
    if (!keys.length) return;
    const parts = keys.map((k) => {
      const [key, n] = k.split("-");
      return sql`(${key}, ${Number(n)})`;
    });
    const found = await tx
      .select({ id: issue.id })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .where(and(eq(issue.workspaceId, workspaceId), sql`(${project.key}, ${issue.number}) in (${sql.join(parts, sql`, `)})`));
    if (found.length) {
      await tx.insert(pageIssue).values(found.map((f) => ({ pageId, issueId: f.id }))).onConflictDoNothing();
    }
  });
}

export function pageRoutes(deps: AppDeps) {
  const { db, events } = deps;
  const app = new Hono<Env>();
  const guard = (a: Parameters<typeof workspaceGuard>[1]) => workspaceGuard(db, a);
  const publish = (workspaceId: string, id?: string) => events.publish({ workspaceId, entity: "page", id }).catch(() => {});

  app.get("/workspaces/:slug/pages", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const projectId = c.req.query("projectId");
    const q = c.req.query("q")?.trim();
    const rows = await db
      .select({
        id: page.id,
        title: page.title,
        projectId: page.projectId,
        parentId: page.parentId,
        position: page.position,
        updatedAt: page.updatedAt,
        updatedByName: user.name,
      })
      .from(page)
      .leftJoin(user, eq(user.id, page.updatedBy))
      .where(
        and(
          pageScope(m),
          projectId === "none" ? isNull(page.projectId) : projectId ? eq(page.projectId, projectId) : undefined,
          q ? sql`(${page.searchVector} @@ plainto_tsquery('simple', ${q}) or ${page.title} ilike ${`%${q.replace(/[%_\\]/g, "\\$&")}%`})` : undefined,
        ),
      )
      .orderBy(asc(page.position), asc(page.title))
      .limit(1000);
    return c.json({ pages: rows });
  });

  app.post("/workspaces/:slug/pages", guard("issue.create"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, createPageSchema);
    if (input.projectId) {
      const [p] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, input.projectId), eq(project.workspaceId, m.workspaceId)));
      if (!p) throw invalid();
    }
    if (input.parentId) {
      const parent = await loadPage(db, m, input.parentId).catch(() => null);
      if (!parent || parent.projectId !== (input.projectId ?? null)) throw invalid();
    }
    const [row] = await db
      .insert(page)
      .values({
        workspaceId: m.workspaceId,
        projectId: input.projectId ?? null,
        parentId: input.parentId ?? null,
        title: input.title,
        position: Date.now(),
        createdBy: requireUser(c).id,
        updatedBy: requireUser(c).id,
      })
      .returning({ id: page.id, title: page.title, projectId: page.projectId, parentId: page.parentId });
    await publish(m.workspaceId, row!.id);
    return c.json({ page: row }, 201);
  });

  app.get("/workspaces/:slug/pages/:id", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const p = await loadPage(db, m, c.req.param("id"));
    const linked = await db
      .select({ id: issue.id, number: issue.number, title: issue.title, projectKey: project.key, projectId: issue.projectId })
      .from(pageIssue)
      .innerJoin(issue, eq(issue.id, pageIssue.issueId))
      .innerJoin(project, eq(project.id, issue.projectId))
      .where(eq(pageIssue.pageId, p.id));
    const [editor] = p.updatedBy ? await db.select({ name: user.name }).from(user).where(eq(user.id, p.updatedBy)) : [];
    return c.json({
      page: {
        id: p.id,
        title: p.title,
        projectId: p.projectId,
        parentId: p.parentId,
        contentText: p.contentText,
        updatedAt: p.updatedAt,
        updatedByName: editor?.name ?? null,
      },
      issues: linked.filter((i) => seesProject(m, i.projectId)).map((i) => ({ ...i, key: `${i.projectKey}-${i.number}` })),
    });
  });

  app.patch("/workspaces/:slug/pages/:id", guard("issue.create"), async (c) => {
    const m = c.get("membership");
    const cur = await loadPage(db, m, c.req.param("id"));
    const input = await parseBody(c, updatePageSchema);
    if (input.parentId) {
      if (input.parentId === cur.id) throw invalid();
      const parent = await loadPage(db, m, input.parentId).catch(() => null);
      if (!parent || parent.projectId !== cur.projectId) throw invalid();
      // Refuse moving a page under its own descendant.
      const loop = (await db.execute(sql`
        with recursive up(id, parent_id, d) as (
          select id, parent_id, 0 from page where id = ${input.parentId}
          union all select p.id, p.parent_id, up.d + 1 from page p join up on p.id = up.parent_id where up.d < 50
        ) select 1 from up where id = ${cur.id} limit 1`)) as unknown as unknown[];
      if (loop.length) throw invalid();
    }
    await db
      .update(page)
      .set({ ...input, updatedBy: requireUser(c).id })
      .where(eq(page.id, cur.id));
    await publish(m.workspaceId, cur.id);
    return c.json({ ok: true });
  });

  app.delete("/workspaces/:slug/pages/:id", guard("issue.create"), async (c) => {
    const m = c.get("membership");
    const cur = await loadPage(db, m, c.req.param("id"));
    await db.delete(page).where(eq(page.id, cur.id));
    await publish(m.workspaceId, cur.id);
    return c.json({ ok: true });
  });

  /** Docs that mention an issue, shown on the issue page. */
  app.get("/workspaces/:slug/issues/:id/pages", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({ id: page.id, title: page.title, updatedAt: page.updatedAt })
      .from(pageIssue)
      .innerJoin(page, eq(page.id, pageIssue.pageId))
      .where(and(eq(pageIssue.issueId, c.req.param("id")), pageScope(m)))
      .orderBy(desc(page.updatedAt));
    return c.json({ pages: rows });
  });

  return app;
}
