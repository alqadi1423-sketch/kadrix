import { CLOSED_CATEGORIES, issueKey, type IssueFilter } from "@veloq/core";
import { issue, issueLabel, project, user, workflowState, type Database } from "@veloq/db";
import { and, asc, desc, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";

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

export function issueFilterWhere(workspaceId: string, f: IssueFilter): SQL {
  const conds: (SQL | undefined)[] = [eq(issue.workspaceId, workspaceId)];
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
  if (f.labelId?.length) {
    conds.push(
      sql`exists (select 1 from ${issueLabel} where ${issueLabel.issueId} = ${issue.id} and ${inArray(issueLabel.labelId, f.labelId)})`,
    );
  }
  if (f.search?.trim()) {
    const q = f.search.trim();
    const m = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d+)$/.exec(q);
    conds.push(
      or(
        // Full-text (works for Arabic and English with the 'simple' config) ...
        sql`${issue.searchVector} @@ plainto_tsquery('simple', ${q})`,
        // ... plus substring/fuzzy match on titles for partial words.
        sql`${issue.title} ilike ${"%" + q.replace(/[%_\\]/g, "\\$&") + "%"}`,
        m ? and(eq(project.key, m[1]!.toUpperCase()), eq(issue.number, Number(m[2]))) : undefined,
      ),
    );
  }
  return and(...conds)!;
}

export async function listIssues(db: Database, workspaceId: string, f: IssueFilter, limit = 500, offset = 0) {
  const rows = await db
    .select(issueColumns)
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .leftJoin(user, eq(user.id, issue.assigneeId))
    .where(issueFilterWhere(workspaceId, f))
    .orderBy(asc(issue.sortOrder), desc(issue.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(withKey);
}

export async function getIssue(db: Database, workspaceId: string, where: SQL) {
  const [row] = await db
    .select({ ...issueColumns, description: issue.description, creatorId: issue.creatorId })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .leftJoin(user, eq(user.id, issue.assigneeId))
    .where(and(eq(issue.workspaceId, workspaceId), where));
  return row ? withKey(row) : null;
}

export function withKey<T extends { projectKey: string; number: number }>(r: T) {
  return { ...r, key: issueKey(r.projectKey, r.number) };
}

export async function listIssuesByIds(db: Database, workspaceId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select(issueColumns)
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .leftJoin(user, eq(user.id, issue.assigneeId))
    .where(and(eq(issue.workspaceId, workspaceId), inArray(issue.id, ids)));
  return rows.map(withKey);
}
