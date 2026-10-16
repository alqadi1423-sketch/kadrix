import { z } from "zod";

/**
 * Workflow states are per project and freely named, but every state belongs
 * to one fixed category. Reports, automations and Git rules work on
 * categories, so renaming a state never breaks them.
 */
export const STATE_CATEGORIES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"] as const;
export type StateCategory = (typeof STATE_CATEGORIES)[number];

export const CLOSED_CATEGORIES: readonly StateCategory[] = ["completed", "canceled"];

/** 0 = none, 1 = urgent ... 4 = low (Linear-style, sortable). */
export const PRIORITIES = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_KEYS = ["none", "urgent", "high", "medium", "low"] as const;

export const ISSUE_TYPES = ["task", "bug", "feature", "epic"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const RELATION_TYPES = ["blocks", "relates", "duplicates"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** States every new project starts with: name keys are translated in the UI. */
export const DEFAULT_STATES: { key: string; category: StateCategory; color: string }[] = [
  { key: "triage", category: "triage", color: "#8e6bb8" },
  { key: "backlog", category: "backlog", color: "#8a9599" },
  { key: "todo", category: "unstarted", color: "#5b7176" },
  { key: "inProgress", category: "started", color: "#d08a00" },
  { key: "inReview", category: "started", color: "#2f7fd1" },
  { key: "done", category: "completed", color: "#2e8b57" },
  { key: "canceled", category: "canceled", color: "#a0a8aa" },
];

export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,5}$/, "key");

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  key: projectKeySchema,
  description: z.string().max(2000).optional(),
});
export const updateProjectSchema = createProjectSchema.partial().omit({ key: true }).extend({
  archived: z.boolean().optional(),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const createStateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  category: z.enum(STATE_CATEGORIES),
  color: hexColor,
});
export const updateStateSchema = createStateSchema
  .partial()
  .extend({ position: z.number().optional(), wipLimit: z.number().int().min(1).max(999).nullable().optional() });

export const labelSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: hexColor,
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createIssueSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(250),
  description: z.string().max(100_000).optional(),
  type: z.enum(ISSUE_TYPES).default("task"),
  stateId: z.string().uuid().optional(),
  priority: z.number().int().min(0).max(4).default(0),
  assigneeId: z.string().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  labelIds: z.array(z.string().uuid()).max(20).optional(),
  dueDate: isoDate.nullable().optional(),
  estimate: z.number().min(0).max(1000).nullable().optional(),
  cycleId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  startDate: isoDate.nullable().optional(),
  /** Custom field values by field id; null clears one. */
  fields: z.record(z.string().uuid(), z.unknown()).optional(),
});

export const updateIssueSchema = createIssueSchema
  .omit({ projectId: true })
  .partial()
  .extend({ sortOrder: z.number().optional() });

export const commentSchema = z.object({ body: z.string().trim().min(1).max(50_000) });

export const relationSchema = z.object({
  type: z.enum(RELATION_TYPES),
  relatedIssueId: z.string().uuid(),
});

/** Filters shared by the issue list API and saved views. */
export const issueFilterSchema = z.object({
  projectId: z.string().uuid().optional(),
  stateCategory: z.array(z.enum(STATE_CATEGORIES)).optional(),
  stateId: z.array(z.string().uuid()).optional(),
  assigneeId: z.array(z.string()).optional(),
  labelId: z.array(z.string().uuid()).optional(),
  priority: z.array(z.number().int().min(0).max(4)).optional(),
  type: z.array(z.enum(ISSUE_TYPES)).optional(),
  cycleId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  includeClosed: z.boolean().optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  updatedSince: z.string().datetime().optional(),
});
export type IssueFilter = z.infer<typeof issueFilterSchema>;

export const VIEW_LAYOUTS = ["list", "board", "timeline", "calendar"] as const;

export const savedViewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  layout: z.enum(VIEW_LAYOUTS),
  filter: issueFilterSchema,
  shared: z.boolean().default(false),
});

/** Human identifier like VEL-42. */
export function issueKey(projectKey: string, number: number) {
  return `${projectKey}-${number}`;
}

/** Parses "VEL-42" (case-insensitive). */
export function parseIssueKey(text: string): { key: string; number: number } | null {
  const m = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d+)$/.exec(text.trim());
  if (!m) return null;
  return { key: m[1]!.toUpperCase(), number: Number(m[2]) };
}
