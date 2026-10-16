import {
  commentSchema,
  createIssueSchema,
  issueFilterSchema,
  parseIssueKey,
  relationSchema,
  savedViewSchema,
  updateIssueSchema,
} from "@veloq/core";
import {
  attachment,
  comment,
  issue,
  issueActivity,
  issueRelation,
  issueSubscriber,
  notification,
  project,
  savedView,
  user,
} from "@veloq/db";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppDeps, type Env, type Membership, assertCan, parseBody, parseQuery, requireUser, seesProject, workspaceGuard } from "../context.js";
import { ApiError, forbidden, invalid, notFound } from "../errors.js";
import { addComment, createIssue, updateIssue, updateIssues } from "../services/issues.js";
import { getIssue, listIssues, listIssuesByIds } from "../services/query.js";
import { enqueueWebhooks } from "../services/webhooks.js";
import { MAX_UPLOAD_BYTES } from "../storage.js";

export function issueRoutes(deps: AppDeps) {
  const { db, events, storage } = deps;
  const app = new Hono<Env>();
  const guard = (a: Parameters<typeof workspaceGuard>[1]) => workspaceGuard(db, a);
  const ctxOf = (workspaceId: string, actorId: string) => ({ db, events, workspaceId, actorId });

  async function issueInWs(m: Membership, id: string) {
    if (!z.string().uuid().safeParse(id).success) throw notFound();
    const [row] = await db
      .select({ id: issue.id, projectId: issue.projectId })
      .from(issue)
      .where(and(eq(issue.id, id), eq(issue.workspaceId, m.workspaceId)));
    if (!row || !seesProject(m, row.projectId)) throw notFound();
    return row;
  }

  /* ------------------------------ issues ------------------------------ */

  app.get("/workspaces/:slug/issues", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    let raw: unknown = {};
    try {
      raw = JSON.parse(c.req.query("filter") ?? "{}");
    } catch {
      throw invalid();
    }
    const filter = parseQuery(raw, issueFilterSchema);
    const limit = Math.min(Number(c.req.query("limit") ?? 500) || 500, 1000);
    const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
    return c.json({ issues: await listIssues(db, m, filter, limit, offset) });
  });

  app.post("/workspaces/:slug/issues", guard("issue.create"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, createIssueSchema);
    const row = await createIssue(ctxOf(m.workspaceId, requireUser(c).id), input);
    return c.json({ issue: await getIssue(db, m, eq(issue.id, row.id)) }, 201);
  });

  app.get("/workspaces/:slug/issues/key/:key", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const k = parseIssueKey(c.req.param("key"));
    if (!k) throw notFound();
    const row = await getIssue(db, m, and(eq(project.key, k.key), eq(issue.number, k.number))!);
    if (!row) throw notFound();
    return c.json({ issue: row });
  });

  app.get("/workspaces/:slug/issues/:id", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) throw notFound();
    const row = await getIssue(db, m, eq(issue.id, id));
    if (!row) throw notFound();
    const [children, relations, subscribed] = await Promise.all([
      listIssues(db, m, { parentId: id, includeClosed: true }),
      db
        .select({ id: issueRelation.id, type: issueRelation.type, issueId: issueRelation.issueId, relatedIssueId: issueRelation.relatedIssueId })
        .from(issueRelation)
        .where(or(eq(issueRelation.issueId, id), eq(issueRelation.relatedIssueId, id))),
      db
        .select({ userId: issueSubscriber.userId })
        .from(issueSubscriber)
        .where(and(eq(issueSubscriber.issueId, id), eq(issueSubscriber.userId, requireUser(c).id))),
    ]);
    const relatedIds = [...new Set(relations.flatMap((r) => [r.issueId, r.relatedIssueId]))].filter((x) => x !== id);
    const related = await listIssuesByIds(db, m, relatedIds);
    return c.json({ issue: row, children, relations, related, subscribed: subscribed.length > 0 });
  });

  app.patch("/workspaces/:slug/issues/:id", guard("issue.update"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, updateIssueSchema);
    await updateIssue(ctxOf(m.workspaceId, requireUser(c).id), c.req.param("id"), input);
    return c.json({ issue: await getIssue(db, m, eq(issue.id, c.req.param("id"))) });
  });

  /** Apply one patch to many issues (board/list multi-select). */
  app.post("/workspaces/:slug/issues/bulk", guard("issue.update"), async (c) => {
    const m = c.get("membership");
    const { ids, patch } = await parseBody(
      c,
      z.object({ ids: z.array(z.string().uuid()).min(1).max(200), patch: updateIssueSchema }),
    );
    const ctx = ctxOf(m.workspaceId, requireUser(c).id);
    await updateIssues(ctx, ids, patch);
    return c.json({ ok: true });
  });

  app.delete("/workspaces/:slug/issues/:id", guard("issue.delete"), async (c) => {
    const m = c.get("membership");
    const found = await issueInWs(m, c.req.param("id"));
    const files = await db.select({ key: attachment.storageKey }).from(attachment).where(eq(attachment.issueId, found.id));
    const gone = await getIssue(db, m, eq(issue.id, found.id));
    await db.transaction(async (tx) => {
      await enqueueWebhooks(tx, m.workspaceId, "issue.deleted", { issue: gone, actorId: requireUser(c).id });
      await tx.delete(issue).where(eq(issue.id, found.id));
    });
    for (const f of files) await storage.delete(f.key).catch(() => {});
    await events.publish({ workspaceId: m.workspaceId, entity: "issue", id: found.id }).catch(() => {});
    return c.json({ ok: true });
  });

  app.get("/workspaces/:slug/issues/:id/activity", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const found = await issueInWs(m, c.req.param("id"));
    const rows = await db
      .select({
        id: issueActivity.id,
        field: issueActivity.field,
        source: issueActivity.source,
        fromValue: issueActivity.fromValue,
        toValue: issueActivity.toValue,
        createdAt: issueActivity.createdAt,
        actorId: issueActivity.actorId,
        actorName: user.name,
      })
      .from(issueActivity)
      .leftJoin(user, eq(user.id, issueActivity.actorId))
      .where(eq(issueActivity.issueId, found.id))
      .orderBy(asc(issueActivity.createdAt));
    return c.json({ activity: rows });
  });

  /* ----------------------------- comments ----------------------------- */

  app.get("/workspaces/:slug/issues/:id/comments", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const found = await issueInWs(m, c.req.param("id"));
    const rows = await db
      .select({
        id: comment.id,
        body: comment.body,
        authorId: comment.authorId,
        authorName: user.name,
        source: comment.source,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
      })
      .from(comment)
      .leftJoin(user, eq(user.id, comment.authorId))
      .where(eq(comment.issueId, found.id))
      .orderBy(asc(comment.createdAt));
    return c.json({ comments: rows });
  });

  app.post("/workspaces/:slug/issues/:id/comments", guard("comment.create"), async (c) => {
    const m = c.get("membership");
    const { body } = await parseBody(c, commentSchema);
    await issueInWs(m, c.req.param("id"));
    const row = await addComment(ctxOf(m.workspaceId, requireUser(c).id), c.req.param("id"), body);
    return c.json({ comment: row }, 201);
  });

  /** Authors edit their own comments; nobody edits someone else's words. */
  app.patch("/workspaces/:slug/comments/:commentId", guard("comment.create"), async (c) => {
    const m = c.get("membership");
    const { body } = await parseBody(c, commentSchema);
    const [row] = await db
      .update(comment)
      .set({ body, editedAt: new Date() })
      .where(
        and(
          eq(comment.id, c.req.param("commentId")),
          eq(comment.workspaceId, m.workspaceId),
          eq(comment.authorId, requireUser(c).id),
        ),
      )
      .returning();
    if (!row) throw notFound();
    await events.publish({ workspaceId: m.workspaceId, entity: "comment", id: row.issueId }).catch(() => {});
    return c.json({ comment: row });
  });

  /** Authors delete their own comments; admins can remove any (moderation). */
  app.delete("/workspaces/:slug/comments/:commentId", guard("comment.create"), async (c) => {
    const m = c.get("membership");
    const u = requireUser(c);
    const [row] = await db
      .select()
      .from(comment)
      .where(and(eq(comment.id, c.req.param("commentId")), eq(comment.workspaceId, m.workspaceId)));
    if (!row) throw notFound();
    await issueInWs(m, row.issueId);
    if (row.authorId !== u.id) assertCan(c, "issue.delete");
    await db.delete(comment).where(eq(comment.id, row.id));
    await events.publish({ workspaceId: m.workspaceId, entity: "comment", id: row.issueId }).catch(() => {});
    return c.json({ ok: true });
  });

  /* ----------------------------- relations ---------------------------- */

  app.post("/workspaces/:slug/issues/:id/relations", guard("issue.update"), async (c) => {
    const m = c.get("membership");
    const a = await issueInWs(m, c.req.param("id"));
    const input = await parseBody(c, relationSchema);
    const b = await issueInWs(m, input.relatedIssueId).catch(() => {
      throw invalid();
    });
    if (a.id === b.id) throw invalid();
    const [row] = await db
      .insert(issueRelation)
      .values({ workspaceId: m.workspaceId, type: input.type, issueId: a.id, relatedIssueId: b.id })
      .onConflictDoNothing()
      .returning();
    await events.publish({ workspaceId: m.workspaceId, entity: "issue", id: a.id }).catch(() => {});
    return c.json({ relation: row ?? null }, 201);
  });

  app.delete("/workspaces/:slug/relations/:relationId", guard("issue.update"), async (c) => {
    const m = c.get("membership");
    const del = await db
      .delete(issueRelation)
      .where(and(eq(issueRelation.id, c.req.param("relationId")), eq(issueRelation.workspaceId, m.workspaceId)))
      .returning();
    if (del.length === 0) throw notFound();
    await events.publish({ workspaceId: m.workspaceId, entity: "issue", id: del[0]!.issueId }).catch(() => {});
    return c.json({ ok: true });
  });

  /* --------------------------- subscriptions -------------------------- */

  app.put("/workspaces/:slug/issues/:id/subscription", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const found = await issueInWs(m, c.req.param("id"));
    await db.insert(issueSubscriber).values({ issueId: found.id, userId: requireUser(c).id }).onConflictDoNothing();
    return c.json({ subscribed: true });
  });

  app.delete("/workspaces/:slug/issues/:id/subscription", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const found = await issueInWs(m, c.req.param("id"));
    await db
      .delete(issueSubscriber)
      .where(and(eq(issueSubscriber.issueId, found.id), eq(issueSubscriber.userId, requireUser(c).id)));
    return c.json({ subscribed: false });
  });

  /* ---------------------------- attachments --------------------------- */

  app.get("/workspaces/:slug/issues/:id/attachments", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const found = await issueInWs(m, c.req.param("id"));
    const rows = await db
      .select({
        id: attachment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        createdAt: attachment.createdAt,
        uploaderName: user.name,
      })
      .from(attachment)
      .leftJoin(user, eq(user.id, attachment.uploaderId))
      .where(eq(attachment.issueId, found.id))
      .orderBy(desc(attachment.createdAt));
    return c.json({ attachments: rows });
  });

  app.post("/workspaces/:slug/issues/:id/attachments", guard("issue.update"), async (c) => {
    const m = c.get("membership");
    const found = await issueInWs(m, c.req.param("id"));
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES + 10_000) throw new ApiError(413, "tooLarge");
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw invalid();
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "tooLarge");
    const data = new Uint8Array(await file.arrayBuffer());
    const key = await storage.put(m.workspaceId, data);
    const [row] = await db
      .insert(attachment)
      .values({
        workspaceId: m.workspaceId,
        issueId: found.id,
        uploaderId: requireUser(c).id,
        fileName: file.name.slice(0, 255) || "file",
        contentType: file.type || "application/octet-stream",
        size: file.size,
        storageKey: key,
      })
      .returning({ id: attachment.id, fileName: attachment.fileName, size: attachment.size });
    await events.publish({ workspaceId: m.workspaceId, entity: "issue", id: found.id }).catch(() => {});
    return c.json({ attachment: row }, 201);
  });

  app.get("/workspaces/:slug/attachments/:attachmentId", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const [row] = await db
      .select()
      .from(attachment)
      .where(and(eq(attachment.id, c.req.param("attachmentId")), eq(attachment.workspaceId, m.workspaceId)));
    if (!row) throw notFound();
    if (row.issueId) await issueInWs(m, row.issueId);
    const data = await storage.get(row.storageKey);
    // Always download, never render inline: uploaded HTML/SVG must not run on our origin.
    return new Response(data, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
        "x-content-type-options": "nosniff",
      },
    });
  });

  app.delete("/workspaces/:slug/attachments/:attachmentId", guard("issue.update"), async (c) => {
    const m = c.get("membership");
    const u = requireUser(c);
    const [row] = await db
      .select()
      .from(attachment)
      .where(and(eq(attachment.id, c.req.param("attachmentId")), eq(attachment.workspaceId, m.workspaceId)));
    if (!row) throw notFound();
    if (row.uploaderId !== u.id) assertCan(c, "issue.delete");
    await db.delete(attachment).where(eq(attachment.id, row.id));
    await storage.delete(row.storageKey).catch(() => {});
    return c.json({ ok: true });
  });

  /* --------------------------- notifications -------------------------- */

  app.get("/workspaces/:slug/notifications", guard("workspace.read"), async (c) => {
    const m = c.get("membership");
    const u = requireUser(c);
    const unreadOnly = c.req.query("unread") === "1";
    const rows = await db
      .select({
        id: notification.id,
        kind: notification.kind,
        data: notification.data,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        actorName: user.name,
        issueId: notification.issueId,
        issueTitle: issue.title,
        issueNumber: issue.number,
        projectKey: project.key,
      })
      .from(notification)
      .leftJoin(user, eq(user.id, notification.actorId))
      .leftJoin(issue, eq(issue.id, notification.issueId))
      .leftJoin(project, eq(project.id, issue.projectId))
      .where(
        and(
          eq(notification.workspaceId, m.workspaceId),
          eq(notification.userId, u.id),
          unreadOnly ? isNull(notification.readAt) : undefined,
        ),
      )
      .orderBy(desc(notification.createdAt))
      .limit(100);
    return c.json({ notifications: rows });
  });

  app.post("/workspaces/:slug/notifications/read", guard("workspace.read"), async (c) => {
    const m = c.get("membership");
    const u = requireUser(c);
    const { ids } = await parseBody(c, z.object({ ids: z.array(z.string().uuid()).max(500).optional() }));
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.workspaceId, m.workspaceId),
          eq(notification.userId, u.id),
          isNull(notification.readAt),
          ids ? inArray(notification.id, ids) : undefined,
        ),
      );
    await events.publish({ workspaceId: m.workspaceId, entity: "notification", userId: u.id }).catch(() => {});
    return c.json({ ok: true });
  });

  /* ---------------------------- saved views --------------------------- */

  app.get("/workspaces/:slug/views", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const u = requireUser(c);
    const rows = await db
      .select()
      .from(savedView)
      .where(and(eq(savedView.workspaceId, m.workspaceId), or(eq(savedView.ownerId, u.id), eq(savedView.shared, true))))
      .orderBy(asc(savedView.name));
    return c.json({ views: rows });
  });

  app.post("/workspaces/:slug/views", guard("view.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, savedViewSchema);
    const [row] = await db
      .insert(savedView)
      .values({ ...input, workspaceId: m.workspaceId, ownerId: requireUser(c).id })
      .returning();
    return c.json({ view: row }, 201);
  });

  app.delete("/workspaces/:slug/views/:viewId", guard("view.manage"), async (c) => {
    const m = c.get("membership");
    const u = requireUser(c);
    const [row] = await db
      .select()
      .from(savedView)
      .where(and(eq(savedView.id, c.req.param("viewId")), eq(savedView.workspaceId, m.workspaceId)));
    if (!row) throw notFound();
    if (row.ownerId !== u.id) throw forbidden();
    await db.delete(savedView).where(eq(savedView.id, row.id));
    return c.json({ ok: true });
  });

  return app;
}
