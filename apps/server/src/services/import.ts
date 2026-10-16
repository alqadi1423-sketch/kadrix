import { MAX_AUTOMATION_DEPTH, type ImportSource, type ImportedIssue } from "@kadrix/core";
import { importJob, importRef, issue, label, user, workflowState, workspaceMember, type Database } from "@kadrix/db";
import { and, eq, inArray } from "drizzle-orm";
import type { EventBus } from "../events.js";
import { createIssue, updateIssue, type IssueContext } from "./issues.js";

export const MAX_IMPORT = 5000;

const LABEL_COLORS = ["#0f766e", "#b45309", "#7c3aed", "#be123c", "#1d4ed8", "#4d7c0f", "#a16207", "#0e7490"];

/**
 * Brings issues from another tool into one project. Importing the same
 * file again updates the issues it created instead of duplicating them.
 * Rules do not fire on imported changes, so a migration does not set off
 * a burst of automated comments.
 */
export async function importIssues(
  deps: { db: Database; events: EventBus },
  args: { workspaceId: string; projectId: string; actorId: string; source: ImportSource; items: ImportedIssue[] },
) {
  const { db } = deps;
  const items = args.items.slice(0, MAX_IMPORT);
  const ctx: IssueContext = {
    db,
    events: deps.events,
    workspaceId: args.workspaceId,
    actorId: args.actorId,
    source: "import",
    depth: MAX_AUTOMATION_DEPTH,
  };

  const states = await db.select().from(workflowState).where(eq(workflowState.projectId, args.projectId)).orderBy(workflowState.position);
  const stateFor = (it: ImportedIssue) => {
    const byName = it.stateName && states.find((s) => s.name.toLocaleLowerCase() === it.stateName!.toLocaleLowerCase());
    if (byName) return byName.id;
    const byCat = it.stateCategory && states.find((s) => s.category === it.stateCategory);
    return byCat ? byCat.id : undefined;
  };

  // Labels: reuse by name (any case), create the rest.
  const wanted = [...new Set(items.flatMap((i) => i.labels))];
  const existing = await db.select().from(label).where(eq(label.workspaceId, args.workspaceId));
  const labelId = new Map(existing.map((l) => [l.name.toLocaleLowerCase(), l.id]));
  let labelsCreated = 0;
  for (const name of wanted) {
    if (labelId.has(name.toLocaleLowerCase())) continue;
    const [row] = await db
      .insert(label)
      .values({ workspaceId: args.workspaceId, name: name.slice(0, 40), color: LABEL_COLORS[labelsCreated % LABEL_COLORS.length]! })
      .onConflictDoNothing()
      .returning();
    if (row) {
      labelId.set(name.toLocaleLowerCase(), row.id);
      labelsCreated++;
    }
  }

  const emails = [...new Set(items.map((i) => i.assigneeEmail).filter((e): e is string => !!e))];
  const members = emails.length
    ? await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .innerJoin(workspaceMember, eq(workspaceMember.userId, user.id))
        .where(and(eq(workspaceMember.workspaceId, args.workspaceId), inArray(user.email, emails)))
    : [];
  const memberId = new Map(members.map((m) => [m.email.toLowerCase(), m.id]));

  const refs = await db
    .select()
    .from(importRef)
    .where(and(eq(importRef.workspaceId, args.workspaceId), eq(importRef.source, args.source)));
  const known = new Map(refs.map((r) => [r.externalId, r.issueId]));

  const stats = { created: 0, updated: 0, skipped: 0, labels: labelsCreated };
  const idOf = new Map<string, string>();
  for (const it of items) {
    const fields = {
      title: it.title,
      description: it.description || undefined,
      type: it.type,
      priority: it.priority,
      stateId: stateFor(it),
      labelIds: it.labels.map((n) => labelId.get(n.toLocaleLowerCase())).filter((x): x is string => !!x),
      assigneeId: it.assigneeEmail ? (memberId.get(it.assigneeEmail) ?? null) : null,
      estimate: it.estimate,
      dueDate: it.dueDate,
    };
    try {
      const prior = known.get(it.externalId);
      const [still] = prior ? await db.select({ id: issue.id, projectId: issue.projectId }).from(issue).where(eq(issue.id, prior)) : [];
      if (still && still.projectId === args.projectId) {
        await updateIssue(ctx, still.id, { ...fields, description: it.description });
        idOf.set(it.externalId, still.id);
        stats.updated++;
        continue;
      }
      const row = await createIssue(ctx, { projectId: args.projectId, ...fields });
      if (it.createdAt && it.createdAt < row.createdAt) {
        await db.update(issue).set({ createdAt: it.createdAt }).where(eq(issue.id, row.id));
      }
      await db
        .insert(importRef)
        .values({ workspaceId: args.workspaceId, source: args.source, externalId: it.externalId, issueId: row.id })
        .onConflictDoUpdate({ target: [importRef.workspaceId, importRef.source, importRef.externalId], set: { issueId: row.id } });
      idOf.set(it.externalId, row.id);
      stats.created++;
    } catch {
      stats.skipped++;
    }
  }

  // Parents last, once every issue exists.
  for (const it of items) {
    const child = idOf.get(it.externalId);
    const parent = it.parentExternalId && (idOf.get(it.parentExternalId) ?? known.get(it.parentExternalId));
    if (child && parent && child !== parent) await updateIssue(ctx, child, { parentId: parent }).catch(() => {});
  }

  await db.insert(importJob).values({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    source: args.source,
    stats,
    createdBy: args.actorId,
  });
  return stats;
}

/** All issues of a GitHub repository through the REST API (up to MAX_IMPORT). */
export async function fetchGitHubIssues(doFetch: typeof fetch, repo: string, token: string | undefined) {
  const out: unknown[] = [];
  for (let page = 1; page <= Math.ceil(MAX_IMPORT / 100); page++) {
    const res = await doFetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=${page}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "kadrix-import",
        "x-github-api-version": "2022-11-28",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: "manual",
    });
    if (!res.ok) throw new Error(`github ${res.status}`);
    const batch = (await res.json()) as unknown[];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}
