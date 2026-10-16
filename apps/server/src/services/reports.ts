import { CLOSED_CATEGORIES, addDays, cumulativeFlow, daysBetween, flowTimes, formatDate, percentile, type IsoDate } from "@veloq/core";
import { issue, issueTransition, timeEntry, user, workflowState, type Database } from "@veloq/db";
import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { Membership } from "../context.js";

/**
 * Flow metrics for a date range, scoped to what the caller may see:
 * lead and cycle time percentiles, weekly throughput, cumulative flow,
 * open work per person and logged time per person.
 */
export async function buildReport(db: Database, m: Membership, opts: { projectId?: string; from: IsoDate; to: IsoDate }) {
  const scope: SQL[] = [eq(issue.workspaceId, m.workspaceId)];
  if (opts.projectId) scope.push(eq(issue.projectId, opts.projectId));
  if (m.projectIds !== null) scope.push(m.projectIds.length ? inArray(issue.projectId, m.projectIds) : sql`false`);
  const end = new Date(`${addDays(opts.to, 1)}T00:00:00Z`);

  const issues = await db
    .select({ issueId: issue.id, createdAt: issue.createdAt, category: workflowState.category, assigneeId: issue.assigneeId, estimate: issue.estimate })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(and(...scope, lte(issue.createdAt, end)))
    .limit(20_000);
  const ids = issues.map((i) => i.issueId);
  const transitions = ids.length
    ? await db
        .select({ issueId: issueTransition.issueId, toCategory: issueTransition.toCategory, at: issueTransition.at })
        .from(issueTransition)
        .where(and(eq(issueTransition.workspaceId, m.workspaceId), inArray(issueTransition.issueId, ids), lte(issueTransition.at, end)))
    : [];

  const start = new Date(`${opts.from}T00:00:00Z`);
  const done = flowTimes(issues, transitions).filter((d) => d.doneAt >= start && d.doneAt < end);
  const lead = done.map((d) => d.leadDays);
  const cycle = done.flatMap((d) => (d.cycleDays === null ? [] : [d.cycleDays]));

  // Weeks counted back from the end of the range.
  const weeks = Math.max(1, Math.ceil((daysBetween(opts.from, opts.to) + 1) / 7));
  const throughput = Array.from({ length: weeks }, (_, i) => {
    const wEnd = addDays(opts.to, -7 * (weeks - 1 - i));
    const wStart = addDays(wEnd, -6);
    const s = new Date(`${wStart}T00:00:00Z`);
    const e = new Date(`${addDays(wEnd, 1)}T00:00:00Z`);
    return { weekEnding: wEnd, done: done.filter((d) => d.doneAt >= s && d.doneAt < e).length };
  });

  const cfdFrom = daysBetween(opts.from, opts.to) > 180 ? addDays(opts.to, -180) : opts.from;
  const cfd = cumulativeFlow(issues, transitions, cfdFrom, opts.to);

  const open = issues.filter((i) => !CLOSED_CATEGORIES.includes(i.category));
  const people = new Map<string | null, { open: number; estimate: number }>();
  for (const i of open) {
    const p = people.get(i.assigneeId) ?? { open: 0, estimate: 0 };
    p.open++;
    p.estimate += i.estimate ?? 0;
    people.set(i.assigneeId, p);
  }

  const timeScope = [eq(timeEntry.workspaceId, m.workspaceId), gte(timeEntry.date, opts.from), lte(timeEntry.date, opts.to)];
  if (opts.projectId || m.projectIds !== null) {
    timeScope.push(ids.length ? inArray(timeEntry.issueId, ids) : sql`false`);
  }
  const time = await db
    .select({ userId: timeEntry.userId, minutes: sql<number>`sum(${timeEntry.minutes})::int` })
    .from(timeEntry)
    .where(and(...timeScope))
    .groupBy(timeEntry.userId);

  const userIds = [...new Set([...people.keys(), ...time.map((t) => t.userId)].filter((x): x is string => !!x))];
  const names = userIds.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));

  return {
    range: { from: opts.from, to: opts.to },
    flow: {
      completed: done.length,
      leadP50: percentile(lead, 50),
      leadP85: percentile(lead, 85),
      cycleP50: percentile(cycle, 50),
      cycleP85: percentile(cycle, 85),
    },
    throughput,
    cfd,
    workload: [...people.entries()]
      .map(([userId, v]) => ({ userId, name: userId ? (nameOf.get(userId) ?? null) : null, ...v }))
      .sort((a, b) => b.open - a.open),
    time: time.map((t) => ({ ...t, name: t.userId ? (nameOf.get(t.userId) ?? null) : null })).sort((a, b) => b.minutes - a.minutes),
  };
}

export const todayIso = () => formatDate(new Date());
