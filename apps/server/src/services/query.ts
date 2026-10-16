import { CLOSED_CATEGORIES, buildTsQuery, foldSearchText, issueKey, type IssueFilter } from "@veloq/core";
import { issue, issueLabel, project, user, workflowState, type Database } from "@veloq/db";
import { and, asc, desc, eq, gte, inArray, lte, notInArray, or, sql, type SQL } from "drizzle-orm";

/** Shape returned for issues everywhere in the API. */
export const issueColumns = {
  id: issue.id,
  projectId: issue.projectId,
  projectKey: project.key,
  number: issue.number,
  type: issue.type,
  title: issue.title,
  stateId: issue.stateId,
  stateName: workflowState.name,
  stateCategory: workflowState.category,
  stateColor: workflowState.color,
  priority: issue.priority,
  assigneeId: issue.assigneeId,
  assigneeName: user.name,
  parentId: issue.parentId,
  cycleId: issue.cycleId,
  milestoneId: issue.milestoneId,
  estimate: issue.estimate,
  startDate: issue.startDate,
  dueDate: issue.dueDate,
  sortOrder: issue.sortOrder,
  completedAt: issue.completedAt,
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
  labelIds: sql<string[]>`coalesce((select array_agg(${issueLabel.labelId}) from ${issueLabel} where ${issueLabel.issueId} = ${issue.id}), '{}')`,
};

/** A workspace id, or a membership that may limit which projects are visible. */
export type Scope = string | { workspaceId: string; projectIds?: string[] | null };

export function scopeWhere(scope: Scope): SQL {
  if (typeof scope === "string") return eq(issue.workspaceId, scope);
  const ws = eq(issue.workspaceId, scope.workspaceId);
  if (!scope.projectIds) return ws;
  // Guests: only their projects. An empty list matches nothing.
  return scope.projectIds.length ? and(ws, inArray(issue.projectId, scope.projectIds))! : sql`false`;
}

export function issueFilterWhere(scope: Scope, f: IssueFilter): SQL {
  const conds: (SQL | undefined)[] = [scopeWhere(scope)];
  if (f.projectId) conds.push(eq(issue.projectId, f.projectId));
  if (f.stateId?.length) conds.push(inArray(issue.stateId, f.stateId));
  if (f.stateCategory?.length) conds.push(inArray(workflowState.category, f.stateCategory));
  else if (!f.includeClosed) conds.push(notInArray(workflowState.category, [...CLOSED_CATEGORIES]));
  if (f.assigneeId?.length) {
    const ids = f.assigneeId.filter((x) => x !== "none");
    const none = f.assigneeId.includes("none");
    conds.push(
      or(
        ids.length ? inArray(issue.assigneeId, ids) : undefined,
        none ? sql`${issue.assigneeId} is null` : undefined,
      ),
    );
  }
  if (f.priority?.length) conds.push(inArray(issue.priority, f.priority));
  if (f.type?.length) conds.push(inArray(issue.type, f.type));
  if (f.cycleId) conds.push(eq(issue.cycleId, f.cycleId));
  if (f.milestoneId) conds.push(eq(issue.milestoneId, f.milestoneId));
  if (f.parentId) conds.push(eq(issue.parentId, f.parentId));
  if (f.dueFrom) conds.push(gte(issue.dueDate, f.dueFrom));
  if (f.dueTo) conds.push(lte(issue.dueDate, f.dueTo));
  if (f.updatedSince) conds.push(gte(issue.updatedAt, new Date(f.updatedSince)));
  if (f.labelId?.length) {
    conds.push(
      sql`exists (select 1 from ${issueLabel} where ${issueLabel.issueId} = ${issue.id} and ${inArray(issueLabel.labelId, f.labelId)})`,
    );
  }
  if (f.search?.trim()) {
    const q = f.search.trim();
    const m = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d+)$/.exec(q);
    const tsq = buildTsQuery(q);
    conds.push(
      or(
        // Full-text on folded words, prefix-matched, Arabic article aware ...
        tsq ? sql`${issue.searchVector} @@ to_tsquery('simple', ${tsq})` : undefined,
        // ... plus a substring match on titles for partial words.
        sql`veloq_search_text(${issue.title}) ilike ${"%" + foldSearchText(q).replace(/[%_\\]/g, "\\$&") + "%"}`,
        m ? and(eq(project.key, m[1]!.toUpperCase()), eq(issue.number, Number(m[2]))) : undefined,
      ),
    );
  }
  return and(...conds)!;
}

export async function listIssues(db: Database, scope: Scope, f: IssueFilter, limit = 500, offset = 0) {
  const rows = await db
    .select(issueColumns)
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .leftJoin(user, eq(user.id, issue.assigneeId))
    .where(issueFilterWhere(scope, f))
    .orderBy(asc(issue.sortOrder), desc(issue.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(withKey);
}

export async function getIssue(db: Database, scope: Scope, where: SQL) {
  const [row] = await db
    .select({ ...issueColumns, description: issue.description, creatorId: issue.creatorId })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .leftJoin(user, eq(user.id, issue.assigneeId))
    .where(and(scopeWhere(scope), where));
  return row ? withKey(row) : null;
}

export function withKey<T extends { projectKey: string; number: number }>(r: T) {
  return { ...r, key: issueKey(r.projectKey, r.number) };
}

export async function listIssuesByIds(db: Database, scope: Scope, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select(issueColumns)
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .leftJoin(user, eq(user.id, issue.assigneeId))
    .where(and(scopeWhere(scope), inArray(issue.id, ids)));
  return rows.map(withKey);
}
