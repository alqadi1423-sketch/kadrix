import { CLOSED_CATEGORIES, type AutomationTrigger, type StateCategory, createIssueSchema, updateIssueSchema } from "@veloq/core";
import {
  comment,
  cycle,
  issue,
  issueActivity,
  issueLabel,
  issueSubscriber,
  issueTransition,
  label,
  milestone,
  notification,
  project,
  projectAccess,
  workflowState,
  workspaceMember,
  type Database,
} from "@veloq/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db, Tx } from "../context.js";
import { ApiError, invalid, notFound } from "../errors.js";
import type { ChangeEvent, EventBus } from "../events.js";
import { runAutomations } from "./automation.js";
import { setFieldValues } from "./fields.js";
import { enqueueWebhooks } from "./webhooks.js";

type CreateInput = z.infer<typeof createIssueSchema>;
type UpdateInput = z.infer<typeof updateIssueSchema>;

export interface IssueContext {
  db: Database;
  events: EventBus;
  workspaceId: string;
  actorId: string | null;
  /** Integration that made the change, when no person did (e.g. "github"). */
  source?: string | null;
  /** How many automation rules led to this change; bounds rule chains. */
  depth?: number;
  /** Rule runs left for everything one change sets off (shared, mutable). */
  budget?: { left: number };
}

export interface AutomationTriggerEvent {
  trigger: AutomationTrigger;
  issueId: string;
}

/** Collects events and publishes them only after the transaction commits. */
class Outbox {
  private items: ChangeEvent[] = [];
  /** Automation triggers, run once the change is committed. */
  triggers: AutomationTriggerEvent[] = [];
  add(e: ChangeEvent) {
    this.items.push(e);
  }
  async flush(bus: EventBus) {
    const seen = new Set<string>();
    for (const e of this.items) {
      const k = JSON.stringify(e);
      if (seen.has(k)) continue;
      seen.add(k);
      await bus.publish(e).catch(() => {});
    }
  }
}

/** Public shape of an issue in webhook payloads. */
async function issuePayload(tx: Tx, issueId: string) {
  const [row] = await tx
    .select({
      id: issue.id,
      number: issue.number,
      projectId: issue.projectId,
      projectKey: project.key,
      title: issue.title,
      type: issue.type,
      priority: issue.priority,
      stateId: issue.stateId,
      stateName: workflowState.name,
      stateCategory: workflowState.category,
      assigneeId: issue.assigneeId,
      parentId: issue.parentId,
      cycleId: issue.cycleId,
      dueDate: issue.dueDate,
      updatedAt: issue.updatedAt,
    })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(eq(issue.id, issueId));
  return row ? { ...row, key: `${row.projectKey}-${row.number}` } : null;
}

/* ---------------------------- validation ---------------------------- */

/** The user must be a member who can see the project (guests only see theirs). */
async function assertMember(db: Db, workspaceId: string, userId: string, projectId: string) {
  const [m] = await db
    .select({ role: workspaceMember.role, granted: projectAccess.projectId })
    .from(workspaceMember)
    .leftJoin(projectAccess, and(eq(projectAccess.userId, workspaceMember.userId), eq(projectAccess.projectId, projectId)))
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)));
  if (!m || (m.role === "guest" && !m.granted)) throw invalid();
}

async function stateInProject(db: Db, projectId: string, stateId: string) {
  const [s] = await db
    .select()
    .from(workflowState)
    .where(and(eq(workflowState.id, stateId), eq(workflowState.projectId, projectId)));
  if (!s) throw invalid();
  return s;
}

async function defaultState(db: Db, projectId: string) {
  const states = await db
    .select()
    .from(workflowState)
    .where(eq(workflowState.projectId, projectId))
    .orderBy(asc(workflowState.position));
  const pick = (cat: StateCategory) => states.find((s) => s.category === cat);
  const s = pick("backlog") ?? pick("unstarted") ?? states[0];
  if (!s) throw invalid();
  return s;
}

async function assertSameProject(db: Db, table: typeof cycle | typeof milestone, id: string, projectId: string) {
  const [r] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.projectId, projectId)));
  if (!r) throw invalid();
}

async function assertLabels(db: Db, workspaceId: string, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: label.id })
    .from(label)
    .where(and(eq(label.workspaceId, workspaceId), inArray(label.id, ids)));
  if (rows.length !== new Set(ids).size) throw invalid();
}

async function assertParent(db: Db, workspaceId: string, parentId: string, selfId?: string) {
  if (parentId === selfId) throw invalid();
  const [p] = await db
    .select({ id: issue.id })
    .from(issue)
    .where(and(eq(issue.id, parentId), eq(issue.workspaceId, workspaceId)));
  if (!p) throw invalid();
  if (selfId) {
    // Reject cycles: walk up from the new parent; we must never reach self.
    const rows = (await db.execute(sql`
      WITH RECURSIVE up(id, parent_id, depth) AS (
        SELECT id, parent_id, 0 FROM issue WHERE id = ${parentId}
        UNION ALL
        SELECT i.id, i.parent_id, up.depth + 1 FROM issue i JOIN up ON i.id = up.parent_id WHERE up.depth < 50
      ) SELECT 1 FROM up WHERE id = ${selfId} LIMIT 1`)) as unknown as unknown[];
    if (rows.length > 0) throw invalid();
  }
}

/* --------------------------- notifications -------------------------- */

async function subscribe(tx: Tx, issueId: string, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  await tx
    .insert(issueSubscriber)
    .values(ids.map((userId) => ({ issueId, userId })))
    .onConflictDoNothing();
}

async function notify(
  tx: Tx,
  outbox: Outbox,
  args: {
    workspaceId: string;
    issueId: string;
    actorId: string | null;
    kind: string;
    userIds: (string | null | undefined)[];
    data?: Record<string, unknown>;
  },
) {
  const ids = [...new Set(args.userIds.filter((x): x is string => !!x && x !== args.actorId))];
  if (ids.length === 0) return;
  await tx.insert(notification).values(
    ids.map((userId) => ({
      workspaceId: args.workspaceId,
      userId,
      actorId: args.actorId,
      issueId: args.issueId,
      kind: args.kind,
      data: args.data ?? {},
    })),
  );
  for (const userId of ids) outbox.add({ workspaceId: args.workspaceId, entity: "notification", userId });
}

async function subscribers(tx: Tx, issueId: string) {
  const rows = await tx.select({ userId: issueSubscriber.userId }).from(issueSubscriber).where(eq(issueSubscriber.issueId, issueId));
  return rows.map((r) => r.userId);
}

/** Mentions are written as <@userId> by the editor. */
export function extractMentions(text: string): string[] {
  return [...new Set([...text.matchAll(/<@([A-Za-z0-9_-]{6,64})>/g)].map((m) => m[1]!))];
}

/* ------------------------------ create ------------------------------ */

export async function createIssue(ctx: IssueContext, input: CreateInput) {
  const outbox = new Outbox();
  const created = await ctx.db.transaction(async (tx) => {
    const [proj] = await tx
      .update(project)
      .set({ issueCounter: sql`${project.issueCounter} + 1` })
      .where(and(eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .returning({ id: project.id, number: project.issueCounter, archivedAt: project.archivedAt });
    if (!proj) throw notFound();
    if (proj.archivedAt) throw invalid();

    const state = input.stateId ? await stateInProject(tx, proj.id, input.stateId) : await defaultState(tx, proj.id);
    if (input.assigneeId) await assertMember(tx, ctx.workspaceId, input.assigneeId, proj.id);
    if (input.parentId) await assertParent(tx, ctx.workspaceId, input.parentId);
    if (input.cycleId) await assertSameProject(tx, cycle, input.cycleId, proj.id);
    if (input.milestoneId) await assertSameProject(tx, milestone, input.milestoneId, proj.id);
    if (input.labelIds) await assertLabels(tx, ctx.workspaceId, input.labelIds);

    const now = new Date();
    const [row] = await tx
      .insert(issue)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: proj.id,
        number: proj.number,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        stateId: state.id,
        priority: input.priority,
        assigneeId: input.assigneeId ?? null,
        creatorId: ctx.actorId,
        parentId: input.parentId ?? null,
        cycleId: input.cycleId ?? null,
        milestoneId: input.milestoneId ?? null,
        estimate: input.estimate ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        sortOrder: -now.getTime(),
        completedAt: state.category === "completed" ? now : null,
        canceledAt: state.category === "canceled" ? now : null,
      })
      .returning();
    if (!row) throw new Error("insert failed");

    if (input.labelIds?.length) {
      await tx.insert(issueLabel).values([...new Set(input.labelIds)].map((labelId) => ({ issueId: row.id, labelId })));
    }
    if (input.fields && Object.keys(input.fields).length) {
      await setFieldValues(tx, ctx, { id: row.id, projectId: proj.id }, input.fields);
    }
    await tx.insert(issueTransition).values({
      workspaceId: ctx.workspaceId,
      issueId: row.id,
      toStateId: state.id,
      toCategory: state.category,
      actorId: ctx.actorId,
      at: now,
    });
    await tx.insert(issueActivity).values({
      workspaceId: ctx.workspaceId,
      issueId: row.id,
      actorId: ctx.actorId,
      field: "created",
    });
    const mentioned = extractMentions(input.description ?? "");
    await subscribe(tx, row.id, [ctx.actorId, input.assigneeId, ...mentioned]);
    await notify(tx, outbox, {
      workspaceId: ctx.workspaceId,
      issueId: row.id,
      actorId: ctx.actorId,
      kind: "assigned",
      userIds: [input.assigneeId],
    });
    await notifyMentions(tx, outbox, ctx, row.id, mentioned);
    await enqueueWebhooks(tx, ctx.workspaceId, "issue.created", { issue: await issuePayload(tx, row.id), actorId: ctx.actorId });
    outbox.add({ workspaceId: ctx.workspaceId, entity: "issue", id: row.id });
    outbox.triggers.push({ trigger: "issueCreated", issueId: row.id });
    return row;
  });
  await outbox.flush(ctx.events);
  await runAutomations(ctx, outbox.triggers);
  return created;
}

async function notifyMentions(tx: Tx, outbox: Outbox, ctx: IssueContext, issueId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  // Only members who can see this issue are told about it: guests outside
  // its project are skipped, so a mention never leaks a hidden title.
  const [it] = await tx.select({ projectId: issue.projectId }).from(issue).where(eq(issue.id, issueId));
  const members = (
    await tx
      .select({ userId: workspaceMember.userId, role: workspaceMember.role, granted: projectAccess.projectId })
      .from(workspaceMember)
      .leftJoin(projectAccess, and(eq(projectAccess.userId, workspaceMember.userId), eq(projectAccess.projectId, it?.projectId ?? sql`null`)))
      .where(and(eq(workspaceMember.workspaceId, ctx.workspaceId), inArray(workspaceMember.userId, userIds)))
  ).filter((x) => x.role !== "guest" || x.granted);
  await notify(tx, outbox, {
    workspaceId: ctx.workspaceId,
    issueId,
    actorId: ctx.actorId,
    kind: "mentioned",
    userIds: members.map((m) => m.userId),
  });
}

/* ------------------------------ update ------------------------------ */

const TRACKED = [
  "title",
  "description",
  "type",
  "priority",
  "assigneeId",
  "parentId",
  "cycleId",
  "milestoneId",
  "estimate",
  "startDate",
  "dueDate",
] as const;

export async function updateIssue(ctx: IssueContext, issueId: string, input: UpdateInput) {
  const outbox = new Outbox();
  const updated = await ctx.db.transaction((tx) => updateIssueIn(tx, outbox, ctx, issueId, input));
  await outbox.flush(ctx.events);
  await runAutomations(ctx, outbox.triggers);
  return updated;
}

/** Apply one patch to many issues atomically: all change or none do. */
export async function updateIssues(ctx: IssueContext, issueIds: string[], input: UpdateInput) {
  const outbox = new Outbox();
  // Lock in a stable order so two bulk edits cannot deadlock each other.
  const ids = [...new Set(issueIds)].sort();
  await ctx.db.transaction(async (tx) => {
    for (const id of ids) await updateIssueIn(tx, outbox, ctx, id, input);
  });
  await outbox.flush(ctx.events);
  await runAutomations(ctx, outbox.triggers);
}

async function updateIssueIn(tx: Tx, outbox: Outbox, ctx: IssueContext, issueId: string, input: UpdateInput) {
  {
    const [cur] = await tx
      .select()
      .from(issue)
      .where(and(eq(issue.id, issueId), eq(issue.workspaceId, ctx.workspaceId)))
      .for("update");
    if (!cur) throw notFound();

    if (input.assigneeId) await assertMember(tx, ctx.workspaceId, input.assigneeId, cur.projectId);
    if (input.parentId) await assertParent(tx, ctx.workspaceId, input.parentId, cur.id);
    if (input.cycleId) await assertSameProject(tx, cycle, input.cycleId, cur.projectId);
    if (input.milestoneId) await assertSameProject(tx, milestone, input.milestoneId, cur.projectId);
    if (input.labelIds) await assertLabels(tx, ctx.workspaceId, input.labelIds);

    const patch: Partial<typeof issue.$inferInsert> = {};
    const activity: (typeof issueActivity.$inferInsert)[] = [];
    for (const field of TRACKED) {
      if (!(field in input)) continue;
      const next = input[field] ?? null;
      const prev = cur[field] ?? null;
      if (next === prev) continue;
      (patch as Record<string, unknown>)[field] = next;
      activity.push({
        workspaceId: ctx.workspaceId,
        issueId,
        actorId: ctx.actorId,
        source: ctx.source ?? null,
        field,
        // Long text is not copied into the history, only the fact it changed.
        fromValue: field === "description" ? null : prev,
        toValue: field === "description" ? null : next,
      });
    }
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

    let stateChange: { from: typeof workflowState.$inferSelect | undefined; to: typeof workflowState.$inferSelect } | null =
      null;
    if (input.stateId && input.stateId !== cur.stateId) {
      const to = await stateInProject(tx, cur.projectId, input.stateId);
      const [from] = await tx.select().from(workflowState).where(eq(workflowState.id, cur.stateId));
      stateChange = { from, to };
      patch.stateId = to.id;
      const now = new Date();
      patch.completedAt = to.category === "completed" ? (cur.completedAt ?? now) : null;
      patch.canceledAt = to.category === "canceled" ? (cur.canceledAt ?? now) : null;
      await tx.insert(issueTransition).values({
        workspaceId: ctx.workspaceId,
        issueId,
        fromStateId: cur.stateId,
        toStateId: to.id,
        fromCategory: from?.category ?? null,
        toCategory: to.category,
        actorId: ctx.actorId,
        at: now,
      });
      activity.push({
        workspaceId: ctx.workspaceId,
        issueId,
        actorId: ctx.actorId,
        source: ctx.source ?? null,
        field: "state",
        fromValue: from ? { id: from.id, name: from.name } : null,
        toValue: { id: to.id, name: to.name },
      });
    }

    if (input.labelIds) {
      const before = await tx.select({ id: issueLabel.labelId }).from(issueLabel).where(eq(issueLabel.issueId, issueId));
      const prev = new Set(before.map((b) => b.id));
      const next = new Set(input.labelIds);
      const changed = prev.size !== next.size || [...next].some((x) => !prev.has(x));
      if (changed) {
        await tx.delete(issueLabel).where(eq(issueLabel.issueId, issueId));
        if (next.size) await tx.insert(issueLabel).values([...next].map((labelId) => ({ issueId, labelId })));
        activity.push({
          workspaceId: ctx.workspaceId,
          issueId,
          actorId: ctx.actorId,
          source: ctx.source ?? null,
          field: "labels",
          fromValue: [...prev],
          toValue: [...next],
        });
        if ([...next].some((x) => !prev.has(x))) outbox.triggers.push({ trigger: "labelAdded", issueId });
      }
    }
    if (input.fields && Object.keys(input.fields).length) {
      const changed = await setFieldValues(tx, ctx, cur, input.fields);
      activity.push(...changed);
    }

    const [row] = Object.keys(patch).length
      ? await tx.update(issue).set(patch).where(eq(issue.id, issueId)).returning()
      : [cur];
    if (activity.length) await tx.insert(issueActivity).values(activity);

    if ("assigneeId" in patch && patch.assigneeId) {
      await subscribe(tx, issueId, [patch.assigneeId]);
      await notify(tx, outbox, {
        workspaceId: ctx.workspaceId,
        issueId,
        actorId: ctx.actorId,
        kind: "assigned",
        userIds: [patch.assigneeId],
      });
    }
    if (stateChange) {
      await notify(tx, outbox, {
        workspaceId: ctx.workspaceId,
        issueId,
        actorId: ctx.actorId,
        kind: "stateChanged",
        userIds: await subscribers(tx, issueId),
        data: { state: stateChange.to.name, category: stateChange.to.category },
      });
    }
    if (typeof patch.description === "string") {
      const before = new Set(extractMentions(cur.description ?? ""));
      const added = extractMentions(patch.description).filter((u) => !before.has(u));
      await subscribe(tx, issueId, added);
      await notifyMentions(tx, outbox, ctx, issueId, added);
    }
    if (activity.length) {
      await enqueueWebhooks(tx, ctx.workspaceId, "issue.updated", {
        issue: await issuePayload(tx, issueId),
        changes: activity.map((a) => ({ field: a.field, from: a.fromValue ?? null, to: a.toValue ?? null })),
        actorId: ctx.actorId,
      });
    }
    if (activity.length || input.sortOrder !== undefined) {
      outbox.add({ workspaceId: ctx.workspaceId, entity: "issue", id: issueId });
    }
    if (stateChange) outbox.triggers.push({ trigger: "stateChanged", issueId });
    if ("assigneeId" in patch) outbox.triggers.push({ trigger: "assigneeChanged", issueId });
    if ("priority" in patch) outbox.triggers.push({ trigger: "priorityChanged", issueId });
    return row!;
  }
}

/* ------------------------------ comments ---------------------------- */

export async function addComment(ctx: IssueContext, issueId: string, body: string) {
  const outbox = new Outbox();
  const created = await ctx.db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ id: issue.id })
      .from(issue)
      .where(and(eq(issue.id, issueId), eq(issue.workspaceId, ctx.workspaceId)));
    if (!cur) throw notFound();
    const [row] = await tx
      .insert(comment)
      .values({ workspaceId: ctx.workspaceId, issueId, authorId: ctx.actorId, source: ctx.source ?? null, body })
      .returning();
    const mentioned = extractMentions(body);
    const subs = await subscribers(tx, issueId);
    await subscribe(tx, issueId, [ctx.actorId, ...mentioned]);
    await notifyMentions(tx, outbox, ctx, issueId, mentioned);
    await notify(tx, outbox, {
      workspaceId: ctx.workspaceId,
      issueId,
      actorId: ctx.actorId,
      kind: "commented",
      userIds: subs.filter((s) => !mentioned.includes(s)),
    });
    await tx.update(issue).set({ updatedAt: new Date() }).where(eq(issue.id, issueId));
    await enqueueWebhooks(tx, ctx.workspaceId, "comment.created", {
      comment: { id: row!.id, body: row!.body, authorId: ctx.actorId, createdAt: row!.createdAt },
      issue: await issuePayload(tx, issueId),
    });
    outbox.add({ workspaceId: ctx.workspaceId, entity: "comment", id: issueId });
    if (ctx.source !== "automation") outbox.triggers.push({ trigger: "commentAdded", issueId });
    return row!;
  });
  await outbox.flush(ctx.events);
  await runAutomations(ctx, outbox.triggers);
  return created;
}

export function isClosed(category: StateCategory) {
  return CLOSED_CATEGORIES.includes(category);
}

export { ApiError };
