import { z } from "zod";

/* ----------------------------- dates ------------------------------ */

/** Dates are plain "YYYY-MM-DD" strings in UTC; no time zones involved. */
export type IsoDate = string;

export function parseDate(d: IsoDate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}
export function formatDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: IsoDate, n: number): IsoDate {
  const x = parseDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return formatDate(x);
}
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 864e5);
}
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/* -------------------------- working days -------------------------- */

/** 0 = Sunday ... 6 = Saturday. Saudi Arabia and much of the region: [5, 6]. */
export const weekendSchema = z.array(z.number().int().min(0).max(6)).max(6);
export const DEFAULT_WEEKEND_AR = [5, 6];
export const DEFAULT_WEEKEND_EN = [6, 0];

export function isWorkingDay(d: IsoDate, weekend: readonly number[]): boolean {
  return !weekend.includes(parseDate(d).getUTCDay());
}

/** Working days from `from` to `to`, both inclusive. */
export function workingDaysBetween(from: IsoDate, to: IsoDate, weekend: readonly number[]): number {
  if (to < from) return 0;
  return eachDay(from, to).filter((d) => isWorkingDay(d, weekend)).length;
}

/** The date `n` working days after `from` (n=0 returns the next working day on or after `from`). */
export function addWorkingDays(from: IsoDate, n: number, weekend: readonly number[]): IsoDate {
  if (weekend.length >= 7) return addDays(from, n);
  let d = from;
  while (!isWorkingDay(d, weekend)) d = addDays(d, 1);
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWorkingDay(d, weekend)) left--;
  }
  return d;
}

/* ---------------------------- burndown ---------------------------- */

export interface BurnIssue {
  /** Points, or 1 when counting issues. */
  weight: number;
  /** When the issue joined the cycle (its creation or assignment date). */
  addedOn: IsoDate;
  /** When it was completed or canceled, if it was. */
  closedOn: IsoDate | null;
}

export interface BurnPoint {
  date: IsoDate;
  scope: number;
  remaining: number;
  /** Ideal remaining, falling only on working days. */
  ideal: number;
}

/**
 * Burndown series for a cycle. Scope can grow mid-cycle (shown honestly as
 * a rising scope line); the ideal line starts from the initial scope and
 * steps down only on working days so weekends don't look like slippage.
 */
export function burndown(
  issues: BurnIssue[],
  start: IsoDate,
  end: IsoDate,
  weekend: readonly number[],
  today: IsoDate,
): BurnPoint[] {
  const days = eachDay(start, end);
  // Planned work is often added on the first days; when nothing was in scope
  // at the start, measure the ideal line from the first day that had scope.
  const scopeAt = (d: IsoDate) => issues.filter((i) => i.addedOn <= d).reduce((s, i) => s + i.weight, 0);
  const initialScope = scopeAt(start) || scopeAt(today < end ? today : end);
  const totalWork = Math.max(workingDaysBetween(start, end, weekend), 1);
  let worked = 0;
  return days
    .filter((d) => d <= today || d === start)
    .map((date) => {
      if (isWorkingDay(date, weekend) && date !== start) worked++;
      const scope = issues.filter((i) => i.addedOn <= date).reduce((s, i) => s + i.weight, 0);
      const remaining = issues
        .filter((i) => i.addedOn <= date && !(i.closedOn && i.closedOn <= date))
        .reduce((s, i) => s + i.weight, 0);
      const ideal = Math.max(initialScope * (1 - worked / Math.max(totalWork - 1, 1)), 0);
      return { date, scope, remaining, ideal: Math.round(ideal * 100) / 100 };
    });
}

/** Average of the last `n` completed cycles' delivered points (capacity planning). */
export function velocity(delivered: number[], n = 3): number | null {
  const recent = delivered.slice(-n);
  if (recent.length === 0) return null;
  return Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10;
}

/* -------------------------- critical path ------------------------- */

export interface TaskNode {
  id: string;
  /** Duration in working days (at least 1). */
  duration: number;
}
export interface Dependency {
  /** `from` must finish before `to` can start ("from blocks to"). */
  from: string;
  to: string;
}

/**
 * Critical path method over the "blocks" graph. Returns the ids on the
 * longest chain of dependent work, plus earliest start offsets. Cycles in
 * the graph are ignored (their edges are dropped) instead of hanging.
 */
export function criticalPath(nodes: TaskNode[], deps: Dependency[]): { path: string[]; length: number; earliestStart: Record<string, number> } {
  const ids = new Set(nodes.map((n) => n.id));
  const dur = new Map(nodes.map((n) => [n.id, Math.max(1, n.duration)]));
  const edges = deps.filter((d) => ids.has(d.from) && ids.has(d.to) && d.from !== d.to);
  const preds = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const succs = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    preds.get(e.to)!.push(e.from);
    succs.get(e.from)!.push(e.to);
  }
  // Kahn's algorithm; nodes left over are in cycles and get no ordering.
  const indeg = new Map(nodes.map((n) => [n.id, preds.get(n.id)!.length]));
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succs.get(id)!) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  const es: Record<string, number> = {};
  const finish = new Map<string, number>();
  const via = new Map<string, string | null>();
  for (const id of order) {
    let start = 0;
    let from: string | null = null;
    for (const p of preds.get(id)!) {
      const f = finish.get(p);
      if (f !== undefined && f > start) {
        start = f;
        from = p;
      }
    }
    es[id] = start;
    finish.set(id, start + dur.get(id)!);
    via.set(id, from);
  }
  let end: string | null = null;
  let best = 0;
  for (const [id, f] of finish) {
    if (f > best) {
      best = f;
      end = id;
    }
  }
  const path: string[] = [];
  for (let cur = end; cur; cur = via.get(cur) ?? null) path.unshift(cur);
  return { path, length: best, earliestStart: es };
}

/* ----------------------------- schemas ---------------------------- */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createCycleSchema = z
  .object({
    name: z.string().trim().max(60).optional(),
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .refine((c) => c.endsOn >= c.startsOn, { message: "range" });

export const updateCycleSchema = z.object({
  name: z.string().trim().max(60).nullable().optional(),
  startsOn: isoDate.optional(),
  endsOn: isoDate.optional(),
});

export const milestoneSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).nullable().optional(),
  targetDate: isoDate.nullable().optional(),
});

export const HEALTH = ["onTrack", "atRisk", "offTrack"] as const;
export type Health = (typeof HEALTH)[number];

export const initiativeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(5000).nullable().optional(),
  targetDate: isoDate.nullable().optional(),
  projectIds: z.array(z.string().uuid()).max(50).optional(),
});

export const statusUpdateSchema = z.object({
  health: z.enum(HEALTH),
  body: z.string().trim().min(1).max(10_000),
});
