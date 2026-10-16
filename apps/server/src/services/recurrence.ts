import { formatDate, nextOccurrence, type RECURRENCE_FREQ } from "@kadrix/core";
import { issueTemplate, recurrence, workspaceMember, type Database } from "@kadrix/db";
import { and, eq, lte } from "drizzle-orm";
import type { EventBus } from "../events.js";
import { createIssue } from "./issues.js";

/**
 * Creates the issues recurring schedules are due for. A schedule that
 * missed several dates (server was off) creates one issue, for the latest
 * missed date, then moves on: nobody wants a pile of stale copies.
 * Rows are claimed with SKIP LOCKED, so several instances can run this.
 */
export async function runRecurrences(db: Database, events: EventBus, today = formatDate(new Date())) {
  let created = 0;
  for (;;) {
    const done = await db.transaction(async (tx) => {
      const [due] = await tx
        .select({ r: recurrence, t: issueTemplate })
        .from(recurrence)
        .innerJoin(issueTemplate, eq(issueTemplate.id, recurrence.templateId))
        .where(and(eq(recurrence.active, true), lte(recurrence.nextDate, today)))
        .orderBy(recurrence.nextDate)
        .limit(1)
        .for("update", { of: recurrence, skipLocked: true });
      if (!due) return true;
      const rule = { ...due.r, freq: due.r.freq as (typeof RECURRENCE_FREQ)[number] };
      // Latest date that was due, and the first one after today.
      let fire = rule.nextDate;
      let next = nextOccurrence(rule, fire);
      while (next <= today) {
        fire = next;
        next = nextOccurrence(rule, fire);
      }
      await tx.update(recurrence).set({ lastDate: fire, nextDate: next }).where(eq(recurrence.id, rule.id));
      return { rule, template: due.t, fire };
    });
    if (done === true) break;
    const { rule, template: t, fire } = done;
    const d = t.defaults;
    // Issues are created in the scheduler's name only while they still
    // belong to the workspace; otherwise they come from "recurring".
    const [owner] = rule.createdBy
      ? await db
          .select({ role: workspaceMember.role })
          .from(workspaceMember)
          .where(and(eq(workspaceMember.workspaceId, rule.workspaceId), eq(workspaceMember.userId, rule.createdBy)))
      : [];
    const actorId = owner && owner.role !== "guest" ? rule.createdBy : null;
    await createIssue(
      { db, events, workspaceId: rule.workspaceId, actorId, source: "recurrence" },
      {
        projectId: t.projectId,
        title: (t.title || t.name).slice(0, 250),
        description: t.description || undefined,
        type: (d.type as "task") ?? "task",
        priority: d.priority ?? 0,
        estimate: d.estimate ?? null,
        assigneeId: d.assigneeId ?? null,
        labelIds: d.labelIds,
        fields: d.fields,
        dueDate: fire,
      },
    ).catch((e) => console.error("recurrence", rule.id, e));
    created++;
  }
  return created;
}

export function startRecurrenceWorker(db: Database, events: EventBus, everyMs = 10 * 60_000) {
  const tick = () => runRecurrences(db, events).catch((e) => console.error("recurrence worker", e));
  void tick();
  const timer = setInterval(tick, everyMs);
  return () => clearInterval(timer);
}
