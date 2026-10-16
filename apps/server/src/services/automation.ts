import {
  MAX_AUTOMATION_DEPTH,
  actionSchema,
  conditionSchema,
  matchesConditions,
  type AutomationAction,
  type RuleSubject,
  type updateIssueSchema,
} from "@kadrix/core";
import { automationRule, issue, issueLabel, workflowState } from "@kadrix/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { addComment, updateIssue, type AutomationTriggerEvent, type IssueContext } from "./issues.js";

type Patch = z.infer<typeof updateIssueSchema>;

export const MAX_RULE_RUNS_PER_CHANGE = 25;
export const MAX_RULES_PER_WORKSPACE = 100;

async function subjectOf(ctx: IssueContext, issueId: string): Promise<(RuleSubject & { projectId: string }) | null> {
  const [row] = await ctx.db
    .select({
      projectId: issue.projectId,
      stateId: issue.stateId,
      stateCategory: workflowState.category,
      priority: issue.priority,
      type: issue.type,
      assigneeId: issue.assigneeId,
      title: issue.title,
    })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(and(eq(issue.id, issueId), eq(issue.workspaceId, ctx.workspaceId)));
  if (!row) return null;
  const labels = await ctx.db.select({ id: issueLabel.labelId }).from(issueLabel).where(eq(issueLabel.issueId, issueId));
  return { ...row, labelIds: labels.map((l) => l.id) };
}

/** Turns a rule's actions into one issue patch plus comments to post. */
function plan(actions: AutomationAction[], subject: RuleSubject) {
  const patch: Patch = {};
  const comments: string[] = [];
  let labels = [...subject.labelIds];
  for (const a of actions) {
    switch (a.kind) {
      case "setState":
        patch.stateId = a.stateId;
        break;
      case "setPriority":
        patch.priority = a.priority;
        break;
      case "assign":
        patch.assigneeId = a.userId;
        break;
      case "addLabel":
        if (!labels.includes(a.labelId)) labels.push(a.labelId);
        patch.labelIds = labels;
        break;
      case "removeLabel":
        labels = labels.filter((l) => l !== a.labelId);
        patch.labelIds = labels;
        break;
      case "setField":
        patch.fields = { ...patch.fields, [a.fieldId]: a.value };
        break;
      case "comment":
        comments.push(a.body);
        break;
    }
  }
  return { patch, comments };
}

/**
 * Runs the workspace's rules for changes that were just committed. Each
 * rule's effects are applied as the "automation" source, which can trigger
 * further rules up to MAX_AUTOMATION_DEPTH. A failing rule records its
 * error and never undoes the change that triggered it.
 */
export async function runAutomations(ctx: IssueContext, events: AutomationTriggerEvent[]) {
  const depth = ctx.depth ?? 0;
  if (!events.length || depth >= MAX_AUTOMATION_DEPTH) return;
  // One person's edit may set off at most this many rule runs in total,
  // however the rules chain, so rules cannot multiply into a flood.
  const budget = ctx.budget ?? { left: MAX_RULE_RUNS_PER_CHANGE };
  const seen = new Set<string>();
  for (const ev of events) {
    const key = `${ev.trigger}:${ev.issueId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const subject = await subjectOf(ctx, ev.issueId);
    if (!subject) continue;
    const rules = await ctx.db
      .select()
      .from(automationRule)
      .where(
        and(
          eq(automationRule.workspaceId, ctx.workspaceId),
          eq(automationRule.trigger, ev.trigger),
          eq(automationRule.active, true),
          or(isNull(automationRule.projectId), eq(automationRule.projectId, subject.projectId)),
        ),
      )
      .orderBy(automationRule.createdAt);
    for (const rule of rules) {
      if (budget.left <= 0) return;
      const conditions = z.array(conditionSchema).safeParse(rule.conditions);
      const actions = z.array(actionSchema).safeParse(rule.actions);
      if (!conditions.success || !actions.success) continue;
      // Re-read between rules so each one sees what the previous one did.
      const now = await subjectOf(ctx, ev.issueId);
      if (!now || !matchesConditions(now, conditions.data)) continue;
      budget.left--;
      const next: IssueContext = { ...ctx, actorId: null, source: "automation", depth: depth + 1, budget };
      const { patch, comments } = plan(actions.data, now);
      let error: string | null = null;
      try {
        if (Object.keys(patch).length) await updateIssue(next, ev.issueId, patch);
        for (const body of comments) await addComment(next, ev.issueId, body);
      } catch (e) {
        error = e instanceof ApiError ? e.code : e instanceof Error ? (e.message || e.name).slice(0, 300) : "failed";
      }
      await ctx.db
        .update(automationRule)
        .set({ runCount: sql`${automationRule.runCount} + 1`, lastRunAt: new Date(), lastError: error })
        .where(eq(automationRule.id, rule.id));
    }
  }
}
