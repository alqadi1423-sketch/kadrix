import { z } from "zod";

/**
 * Parsing for Git integrations: find issue keys in branch names, PR titles,
 * PR bodies and commit messages, and classify them by "magic words".
 *
 *   closing   fixes / closes / resolves VEL-42   → issue completes on merge
 *   linking   refs / part of / related to VEL-42 → linked only
 *   ignored   skip VEL-42                        → not linked at all
 *   plain     VEL-42 anywhere else              → linked only
 *
 * Matching is case-insensitive and accepts Arabic equivalents of the
 * closing words, so teams can write commit messages in Arabic.
 */

export type LinkIntent = "closes" | "links";

const CLOSING = [
  "close",
  "closes",
  "closed",
  "closing",
  "fix",
  "fixes",
  "fixed",
  "fixing",
  "resolve",
  "resolves",
  "resolved",
  "resolving",
  "complete",
  "completes",
  "completed",
  "يغلق",
  "يصلح",
  "يحل",
  "أغلق",
  "أصلح",
  "حل",
];
const IGNORE = ["skip", "ignore", "تجاهل"];

const KEY = "([A-Za-z][A-Za-z0-9]{1,5})-(\\d{1,7})";

export interface FoundKey {
  key: string; // normalized "VEL-42"
  intent: LinkIntent;
}

export function findIssueKeys(text: string | null | undefined): FoundKey[] {
  if (!text) return [];
  const out = new Map<string, LinkIntent>();
  const ignored = new Set<string>();
  // Word before the key (optionally followed by ":"), possibly in a list: "fixes VEL-1, VEL-2".
  const re = new RegExp(`(?:^|[^A-Za-z0-9])${KEY}(?![A-Za-z0-9])`, "g");
  for (const m of text.matchAll(re)) {
    const key = `${m[1]!.toUpperCase()}-${Number(m[2])}`;
    const before = text.slice(0, m.index! + (m[0].length - m[1]!.length - m[2]!.length - 1));
    // The nearest verb in the same clause decides the intent.
    const clause = before.split(/[.;\n]|\band\b|و\s/).pop() ?? "";
    const words = clause
      .toLowerCase()
      .split(/[\s,:()[\]]+/)
      .filter((w) => w && !/^[a-z][a-z0-9]{1,5}-\d+$/.test(w));
    const verb = words.at(-1) ?? "";
    if (IGNORE.includes(verb)) {
      ignored.add(key);
      continue;
    }
    const intent: LinkIntent = CLOSING.includes(verb) ? "closes" : "links";
    if (out.get(key) !== "closes") out.set(key, intent);
  }
  for (const k of ignored) out.delete(k);
  return [...out].map(([key, intent]) => ({ key, intent }));
}

/** Keys embedded in a branch name like "vel-42-fix-login" or "feature/VEL-42". */
export function keysFromBranch(branch: string | null | undefined): string[] {
  if (!branch) return [];
  const re = new RegExp(`(?:^|[/_.-])${KEY}(?=$|[/_.-])`, "gi");
  return [...new Set([...branch.matchAll(re)].map((m) => `${m[1]!.toUpperCase()}-${Number(m[2])}`))];
}

/** Suggested branch for an issue: "vel-42-fix-login-page" (ASCII only, 60 chars). */
export function branchName(key: string, title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug ? `${key.toLowerCase()}-${slug}` : key.toLowerCase();
}

/* ------------------------- PR state mapping ------------------------ */

/** Lifecycle points of a pull/merge request that can move an issue. */
export const PR_EVENTS = ["draft", "open", "reviewRequested", "merged", "closed"] as const;
export type PrEvent = (typeof PR_EVENTS)[number];

/**
 * Per-integration mapping from PR lifecycle to a state category. `null`
 * means "don't move the issue". Defaults follow the common team practice.
 */
export const DEFAULT_PR_MAPPING: Record<PrEvent, "started" | "completed" | null> & { reviewStateName: string | null } = {
  draft: "started",
  open: "started",
  reviewRequested: "started",
  merged: "completed",
  closed: null,
  reviewStateName: null,
};

export const prMappingSchema = z.object({
  draft: z.enum(["started", "completed"]).nullable(),
  open: z.enum(["started", "completed"]).nullable(),
  reviewRequested: z.enum(["started", "completed"]).nullable(),
  merged: z.enum(["started", "completed"]).nullable(),
  closed: z.enum(["started", "completed"]).nullable(),
  /** Optional: a specific state name used for review (e.g. "In review"). */
  reviewStateName: z.string().max(40).nullable(),
});

/* ------------------------------ schemas ----------------------------- */

export const TOKEN_SCOPES = ["read", "write"] as const;

export const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(366).nullable().optional(),
});

export const WEBHOOK_EVENTS = [
  "issue.created",
  "issue.updated",
  "issue.deleted",
  "comment.created",
  "cycle.completed",
  "release.published",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_FORMATS = ["kadrix", "slack", "discord"] as const;

export const createWebhookSchema = z.object({
  url: z.string().url().max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  format: z.enum(WEBHOOK_FORMATS).default("kadrix"),
  locale: z.enum(["ar", "en"]).default("en"),
});

export const createIntegrationSchema = z.object({
  provider: z.enum(["github", "gitlab"]),
  name: z.string().trim().min(1).max(60),
});

export const releaseSchema = z.object({
  version: z.string().trim().min(1).max(40),
  name: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(50_000).nullable().optional(),
  issueIds: z.array(z.string().uuid()).max(1000).optional(),
});
