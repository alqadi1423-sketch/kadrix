import { patchOf } from "./schemas.js";
import { z } from "zod";
import { ISSUE_TYPES, STATE_CATEGORIES, type StateCategory } from "./work.js";
import { addDays, formatDate, parseDate, type IsoDate } from "./planning.js";

/* -------------------------- custom fields ------------------------- */

export const FIELD_KINDS = ["text", "number", "select", "multiSelect", "date", "user", "checkbox", "url"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

const optionSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

export const customFieldSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(FIELD_KINDS),
  /** Null: available in every project of the workspace. */
  projectId: z.string().uuid().nullable().default(null),
  options: z.array(optionSchema).max(100).default([]),
});
export const updateCustomFieldSchema = patchOf(customFieldSchema.omit({ kind: true, projectId: true })).extend({
  position: z.number().optional(),
});

export interface FieldDef {
  kind: FieldKind;
  options: { id: string }[];
}

/**
 * Checks a value against its field and returns the normalized value to
 * store, or null to clear it. Throws on a value of the wrong shape.
 */
export function normalizeFieldValue(field: FieldDef, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  const optionIds = new Set(field.options.map((o) => o.id));
  switch (field.kind) {
    case "text":
      return z.string().max(2000).parse(value);
    case "number":
      return z.number().finite().parse(value);
    case "checkbox":
      return z.boolean().parse(value);
    case "date":
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(value);
    case "url":
      return z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u)).parse(value);
    case "user":
      return z.string().min(1).max(64).parse(value);
    case "select": {
      const v = z.string().parse(value);
      if (!optionIds.has(v)) throw new Error("unknown option");
      return v;
    }
    case "multiSelect": {
      const v = [...new Set(z.array(z.string()).max(100).parse(value))];
      if (v.some((x) => !optionIds.has(x))) throw new Error("unknown option");
      return v.length ? v : null;
    }
  }
}

/* ---------------------------- templates --------------------------- */

export const issueTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  projectId: z.string().uuid(),
  title: z.string().max(300).default(""),
  description: z.string().max(100_000).default(""),
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  estimate: z.number().min(0).max(1000).nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  labelIds: z.array(z.string().uuid()).max(50).default([]),
  fields: z.record(z.string(), z.unknown()).default({}),
});
export const updateIssueTemplateSchema = patchOf(issueTemplateSchema.omit({ projectId: true }));

/* --------------------------- recurrence --------------------------- */

export const RECURRENCE_FREQ = ["daily", "weekly", "monthly"] as const;

export const recurrenceSchema = z
  .object({
    templateId: z.string().uuid(),
    freq: z.enum(RECURRENCE_FREQ),
    interval: z.number().int().min(1).max(12).default(1),
    /** Weekly: days of the week (0 = Sunday). */
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    /** Monthly: day of the month; 31 means the last day in shorter months. */
    dayOfMonth: z.number().int().min(1).max(31).nullable().default(null),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    active: z.boolean().default(true),
  })
  .refine((r) => r.freq !== "weekly" || r.weekdays.length > 0, { path: ["weekdays"] })
  .refine((r) => r.freq !== "monthly" || r.dayOfMonth !== null, { path: ["dayOfMonth"] });
export type Recurrence = z.infer<typeof recurrenceSchema>;

function lastDayOfMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/**
 * The first date the rule fires strictly after `after` (or on `startDate`
 * when nothing has fired yet). Pure calendar math in UTC dates.
 */
export function nextOccurrence(rule: Pick<Recurrence, "freq" | "interval" | "weekdays" | "dayOfMonth" | "startDate">, after: IsoDate | null): IsoDate {
  const from = after === null ? rule.startDate : addDays(after, 1);
  const start = parseDate(rule.startDate);
  if (rule.freq === "daily") {
    const d = from < rule.startDate ? rule.startDate : from;
    const offset = Math.round((parseDate(d).getTime() - start.getTime()) / 864e5);
    const rem = offset % rule.interval;
    return rem === 0 ? d : addDays(d, rule.interval - rem);
  }
  if (rule.freq === "weekly") {
    // Weeks are counted from the Sunday on or before the start date.
    const anchor = addDays(rule.startDate, -start.getUTCDay());
    let d = from < rule.startDate ? rule.startDate : from;
    for (let i = 0; i < 7 * 12 * 2 + 7; i++, d = addDays(d, 1)) {
      const week = Math.floor(Math.round((parseDate(d).getTime() - parseDate(anchor).getTime()) / 864e5) / 7);
      if (week % rule.interval === 0 && rule.weekdays.includes(parseDate(d).getUTCDay())) return d;
    }
    throw new Error("no occurrence");
  }
  const want = rule.dayOfMonth ?? start.getUTCDate();
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (let i = 0; i < 400; i++) {
    const day = Math.min(want, lastDayOfMonth(y, m));
    const d = formatDate(new Date(Date.UTC(y, m, day)));
    if (d >= from && d >= rule.startDate) return d;
    m += rule.interval;
    y += Math.floor(m / 12);
    m %= 12;
  }
  throw new Error("no occurrence");
}

/* ---------------------------- automation -------------------------- */

export const AUTOMATION_TRIGGERS = [
  "issueCreated",
  "stateChanged",
  "assigneeChanged",
  "priorityChanged",
  "labelAdded",
  "commentAdded",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const CONDITION_FIELDS = ["stateCategory", "stateId", "priority", "type", "labelId", "assigneeId", "title"] as const;
export const CONDITION_OPS = ["is", "isNot", "contains"] as const;

export const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  /** Strings and numbers; null means "empty" (e.g. unassigned). */
  value: z.union([z.string().max(200), z.number(), z.null()]),
});

export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setState"), stateId: z.string().uuid() }),
  z.object({ kind: z.literal("setPriority"), priority: z.number().int().min(0).max(4) }),
  z.object({ kind: z.literal("assign"), userId: z.string().nullable() }),
  z.object({ kind: z.literal("addLabel"), labelId: z.string().uuid() }),
  z.object({ kind: z.literal("removeLabel"), labelId: z.string().uuid() }),
  z.object({ kind: z.literal("comment"), body: z.string().trim().min(1).max(5000) }),
  z.object({ kind: z.literal("setField"), fieldId: z.string().uuid(), value: z.unknown() }),
]);
export type AutomationAction = z.infer<typeof actionSchema>;

export const automationRuleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  projectId: z.string().uuid().nullable().default(null),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: z.array(conditionSchema).max(20).default([]),
  actions: z.array(actionSchema).min(1).max(10),
  active: z.boolean().default(true),
});
export const updateAutomationRuleSchema = patchOf(automationRuleSchema.omit({ projectId: true }));
export type Condition = z.infer<typeof conditionSchema>;

/** The parts of an issue rules can look at. */
export interface RuleSubject {
  stateId: string;
  stateCategory: StateCategory;
  priority: number;
  type: string;
  assigneeId: string | null;
  labelIds: string[];
  title: string;
}

export function matchesConditions(issue: RuleSubject, conditions: Condition[]): boolean {
  return conditions.every((c) => {
    const isMatch = (() => {
      switch (c.field) {
        case "labelId":
          return c.op === "contains" || c.op === "is" ? issue.labelIds.includes(String(c.value)) : !issue.labelIds.includes(String(c.value));
        case "title": {
          const has = issue.title.toLocaleLowerCase().includes(String(c.value ?? "").toLocaleLowerCase());
          return c.op === "isNot" ? !has : c.op === "contains" ? has : issue.title === c.value;
        }
        default: {
          const actual = issue[c.field];
          const eq = actual === c.value || (typeof actual === "number" && Number(c.value) === actual);
          if (c.op === "contains") return String(actual ?? "").includes(String(c.value ?? ""));
          return c.op === "is" ? eq : !eq;
        }
      }
    })();
    return isMatch;
  });
}

/** Rules may trigger rules; this bounds the chain so loops end. */
export const MAX_AUTOMATION_DEPTH = 3;

/* --------------------------- time tracking ------------------------ */

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Minutes from a short duration: "90", "90m", "1.5h", "1h 30m", "2d"
 * (a day is 8 hours), with Arabic digits and units: "١س ٣٠د", "٢ ساعة".
 */
export function parseDuration(input: string): number | null {
  const s = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[٫,]/g, ".")
    .toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const units: Record<string, number> = { d: 480, "يوم": 480, "ي": 480, h: 60, "س": 60, "ساعة": 60, "ساعات": 60, m: 1, "د": 1, "دقيقة": 1, "دقائق": 1 };
  const re = /(\d+(?:\.\d+)?)\s*(d|h|m|يوم|ي|ساعات|ساعة|س|دقائق|دقيقة|د)/gu;
  let total = 0;
  let matched = "";
  for (const m of s.matchAll(re)) {
    total += Number(m[1]) * units[m[2]!]!;
    matched += m[0];
  }
  if (!matched || matched.replace(/\s/g, "").length !== s.replace(/\s/g, "").length) return null;
  return total > 0 ? Math.round(total) : null;
}

export function formatDuration(minutes: number): { h: number; m: number } {
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

export const timeEntrySchema = z.object({
  minutes: z.number().int().min(1).max(24 * 60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).default(""),
});

/* ----------------------------- reports ---------------------------- */

export interface TransitionRow {
  issueId: string;
  toCategory: StateCategory;
  at: Date;
}
export interface IssueTimes {
  issueId: string;
  createdAt: Date;
}

/**
 * Lead time: created to done. Cycle time: first moved to "started" to
 * done. Reopened issues count from the last time they were finished.
 * Results in days, rounded to one decimal.
 */
export function flowTimes(issues: IssueTimes[], transitions: TransitionRow[]) {
  const byIssue = new Map<string, TransitionRow[]>();
  for (const t of transitions) (byIssue.get(t.issueId) ?? byIssue.set(t.issueId, []).get(t.issueId)!).push(t);
  const out: { issueId: string; doneAt: Date; leadDays: number; cycleDays: number | null }[] = [];
  const days = (a: Date, b: Date) => Math.round(((b.getTime() - a.getTime()) / 864e5) * 10) / 10;
  for (const i of issues) {
    const ts = (byIssue.get(i.issueId) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime());
    const last = ts.at(-1);
    if (!last || last.toCategory !== "completed") continue;
    const started = ts.find((t) => t.toCategory === "started");
    out.push({ issueId: i.issueId, doneAt: last.at, leadDays: days(i.createdAt, last.at), cycleDays: started ? days(started.at, last.at) : null });
  }
  return out;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx]!;
}

/**
 * Cumulative flow: for each day, how many issues sat in each state
 * category at the end of that day. `initial` is the category an issue had
 * when it was created (its first transition, or its current category).
 */
export function cumulativeFlow(
  issues: { issueId: string; createdAt: Date; category: StateCategory }[],
  transitions: TransitionRow[],
  from: IsoDate,
  to: IsoDate,
) {
  const byIssue = new Map<string, TransitionRow[]>();
  for (const t of transitions) (byIssue.get(t.issueId) ?? byIssue.set(t.issueId, []).get(t.issueId)!).push(t);
  for (const list of byIssue.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: ({ date: IsoDate } & Record<StateCategory, number>)[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const end = parseDate(addDays(d, 1)).getTime();
    const row = { date: d, ...Object.fromEntries(STATE_CATEGORIES.map((c) => [c, 0])) } as { date: IsoDate } & Record<StateCategory, number>;
    for (const i of issues) {
      if (i.createdAt.getTime() >= end) continue;
      const ts = byIssue.get(i.issueId) ?? [];
      let cat: StateCategory = ts[0]?.toCategory ?? i.category;
      for (const t of ts) if (t.at.getTime() < end) cat = t.toCategory;
      row[cat]++;
    }
    out.push(row);
  }
  return out;
}

/* ----------------------------- import ----------------------------- */

export const IMPORT_SOURCES = ["csv", "jira", "linear", "github"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** RFC 4180 CSV with quoted fields, CRLF or LF, and an optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** One issue in a shape every importer produces. */
export interface ImportedIssue {
  externalId: string;
  title: string;
  description: string;
  stateName: string | null;
  stateCategory: StateCategory | null;
  priority: number;
  type: (typeof ISSUE_TYPES)[number];
  labels: string[];
  assigneeEmail: string | null;
  estimate: number | null;
  dueDate: IsoDate | null;
  createdAt: Date | null;
  parentExternalId: string | null;
}

const STATE_WORDS: [RegExp, StateCategory][] = [
  [/backlog|icebox/i, "backlog"],
  [/cancel|won.?t|duplicate|ملغ/i, "canceled"],
  [/done|closed|complete|resolved|released|shipped|merged|مكتمل|منجز/i, "completed"],
  [/progress|review|doing|testing|qa|started|active|قيد/i, "started"],
  [/to ?do|open|new|selected|ready|triage|unstarted|planned|جديد/i, "unstarted"],
];
export function guessCategory(stateName: string | null | undefined): StateCategory | null {
  if (!stateName) return null;
  return STATE_WORDS.find(([re]) => re.test(stateName))?.[1] ?? null;
}

function guessPriority(p: string | undefined): number {
  const v = (p ?? "").toLowerCase();
  if (/urgent|highest|blocker|critical|^1$|عاجل/.test(v)) return 1;
  if (/high|major|^2$|عال/.test(v)) return 2;
  if (/medium|normal|^3$|متوسط/.test(v)) return 3;
  if (/low|minor|trivial|lowest|^4$|منخفض/.test(v)) return 4;
  return 0;
}

function guessType(t: string | undefined): (typeof ISSUE_TYPES)[number] {
  const v = (t ?? "").toLowerCase();
  if (/bug|defect|خطأ|علة/.test(v)) return "bug";
  if (/epic|ملحمة/.test(v)) return "epic";
  if (/feature|story|improvement|enhancement|ميزة|قصة/.test(v)) return "feature";
  return "task";
}

function toDate(s: string | undefined): IsoDate | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : formatDate(d);
}
function toTime(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toNumber(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Column mapping for a generic CSV: our field name to a header in the file. */
export const csvMappingSchema = z.object({
  externalId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  state: z.string().optional(),
  priority: z.string().optional(),
  type: z.string().optional(),
  labels: z.string().optional(),
  assignee: z.string().optional(),
  estimate: z.string().optional(),
  dueDate: z.string().optional(),
  createdAt: z.string().optional(),
  parent: z.string().optional(),
});
export type CsvMapping = z.infer<typeof csvMappingSchema>;

/** Header names Jira and Linear use in their CSV exports. */
export const CSV_PRESETS: Record<"jira" | "linear", CsvMapping> = {
  jira: {
    externalId: "Issue key",
    title: "Summary",
    description: "Description",
    state: "Status",
    priority: "Priority",
    type: "Issue Type",
    labels: "Labels",
    assignee: "Assignee",
    estimate: "Custom field (Story Points)",
    dueDate: "Due date",
    createdAt: "Created",
    parent: "Parent",
  },
  linear: {
    externalId: "ID",
    title: "Title",
    description: "Description",
    state: "Status",
    priority: "Priority",
    labels: "Labels",
    assignee: "Assignee",
    estimate: "Estimate",
    dueDate: "Due Date",
    createdAt: "Created",
    parent: "Parent issue",
  },
};

export function issuesFromCsv(text: string, mapping: CsvMapping): ImportedIssue[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h) => h.trim());
  // Jira repeats a header (e.g. several "Labels" columns): read all of them.
  const cols = (h: string | undefined) => (h ? names.flatMap((n, i) => (n.toLowerCase() === h.toLowerCase() ? [i] : [])) : []);
  const one = (r: string[], h: string | undefined) => {
    const i = cols(h)[0];
    return i === undefined ? undefined : r[i]?.trim() || undefined;
  };
  const many = (r: string[], h: string | undefined) =>
    cols(h)
      .flatMap((i) => (r[i] ?? "").split(/[,;]/))
      .map((x) => x.trim())
      .filter(Boolean);
  return rows
    .map((r, idx) => {
      const state = one(r, mapping.state) ?? null;
      return {
        externalId: one(r, mapping.externalId) ?? `row-${idx + 2}`,
        title: (one(r, mapping.title) ?? "").slice(0, 300),
        description: one(r, mapping.description) ?? "",
        stateName: state,
        stateCategory: guessCategory(state),
        priority: guessPriority(one(r, mapping.priority)),
        type: guessType(one(r, mapping.type)),
        labels: [...new Set(many(r, mapping.labels))].slice(0, 20),
        assigneeEmail: (() => {
          const a = one(r, mapping.assignee);
          return a && a.includes("@") ? a.toLowerCase() : null;
        })(),
        estimate: toNumber(one(r, mapping.estimate)),
        dueDate: toDate(one(r, mapping.dueDate)),
        createdAt: toTime(one(r, mapping.createdAt)),
        parentExternalId: one(r, mapping.parent) ?? null,
      };
    })
    .filter((i) => i.title);
}

/** Issues from the GitHub REST API (`GET /repos/{owner}/{repo}/issues`), pull requests skipped. */
export function issuesFromGitHub(
  items: {
    number: number;
    title: string;
    body?: string | null;
    state: string;
    state_reason?: string | null;
    labels?: (string | { name?: string })[];
    created_at?: string;
    pull_request?: unknown;
    milestone?: { due_on?: string | null } | null;
  }[],
): ImportedIssue[] {
  return items
    .filter((i) => !i.pull_request)
    .map((i) => {
      const labels = (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean);
      const closed = i.state === "closed";
      return {
        externalId: `#${i.number}`,
        title: i.title.slice(0, 300),
        description: i.body ?? "",
        stateName: null,
        stateCategory: closed ? (i.state_reason === "not_planned" ? "canceled" : "completed") : "unstarted",
        priority: guessPriority(labels.find((l) => /priority|p[0-4]/i.test(l))),
        type: guessType(labels.join(" ")),
        labels: labels.slice(0, 20),
        assigneeEmail: null,
        estimate: null,
        dueDate: toDate(i.milestone?.due_on ?? undefined),
        createdAt: toTime(i.created_at),
        parentExternalId: null,
      };
    });
}

/* --------------------------- search text -------------------------- */

/**
 * The same folding the database applies before indexing (see migration
 * `veloq_search_text`): Arabic letter variants, diacritics and tatweel,
 * so "إدارة" finds "ادارة" and "مدرسة" finds "مدرسه".
 */
export function foldSearchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

const AR_PREFIXES = ["ال", "وال", "بال", "كال", "فال", "لل"];
const AR_LETTER = /[؀-ۿ]/;

/**
 * A `to_tsquery('simple', …)` string for what someone typed: every word
 * must match, as a prefix, and an Arabic word also matches with the usual
 * attached article ("مشروع" finds "المشروع" and "والمشروع").
 * Returns null when nothing searchable is left.
 */
export function buildTsQuery(input: string): string | null {
  const words = foldSearchText(input)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 8);
  if (!words.length) return null;
  return words
    .map((w) => {
      if (!AR_LETTER.test(w)) return `${w}:*`;
      const base = w.startsWith("ال") && w.length > 3 ? w.slice(2) : w;
      const forms = new Set([w, base, ...AR_PREFIXES.map((p) => p + base)]);
      return `(${[...forms].map((f) => `${f}:*`).join(" | ")})`;
    })
    .join(" & ");
}
