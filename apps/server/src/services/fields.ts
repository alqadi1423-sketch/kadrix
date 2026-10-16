import { normalizeFieldValue } from "@kadrix/core";
import { customField, issueActivity, issueFieldValue, workspaceMember } from "@kadrix/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Tx } from "../context.js";
import { invalid } from "../errors.js";

/**
 * Validates and stores custom field values for one issue. Fields must
 * belong to the workspace and apply to the issue's project; user fields
 * must name a member. Returns activity rows (not yet stored) for what
 * actually changed.
 */
export async function setFieldValues(
  tx: Tx,
  ctx: { workspaceId: string; actorId: string | null; source?: string | null },
  target: { id: string; projectId: string },
  values: Record<string, unknown>,
): Promise<(typeof issueActivity.$inferInsert)[]> {
  const ids = Object.keys(values);
  if (!ids.length) return [];
  const fields = await tx
    .select()
    .from(customField)
    .where(
      and(
        eq(customField.workspaceId, ctx.workspaceId),
        inArray(customField.id, ids),
        or(isNull(customField.projectId), eq(customField.projectId, target.projectId)),
      ),
    );
  if (fields.length !== ids.length) throw invalid();
  const current = await tx
    .select()
    .from(issueFieldValue)
    .where(and(eq(issueFieldValue.issueId, target.id), inArray(issueFieldValue.fieldId, ids)));
  const before = new Map(current.map((c) => [c.fieldId, c.value]));
  const activity: (typeof issueActivity.$inferInsert)[] = [];

  for (const f of fields) {
    let next: unknown;
    try {
      next = normalizeFieldValue(f, values[f.id]);
    } catch {
      throw invalid();
    }
    if (f.kind === "user" && next) {
      const [m] = await tx
        .select({ userId: workspaceMember.userId })
        .from(workspaceMember)
        .where(and(eq(workspaceMember.workspaceId, ctx.workspaceId), eq(workspaceMember.userId, String(next))));
      if (!m) throw invalid();
    }
    const prev = before.get(f.id) ?? null;
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    if (next === null) {
      await tx.delete(issueFieldValue).where(and(eq(issueFieldValue.issueId, target.id), eq(issueFieldValue.fieldId, f.id)));
    } else {
      await tx
        .insert(issueFieldValue)
        .values({ workspaceId: ctx.workspaceId, issueId: target.id, fieldId: f.id, value: next })
        .onConflictDoUpdate({ target: [issueFieldValue.issueId, issueFieldValue.fieldId], set: { value: next } });
    }
    activity.push({
      workspaceId: ctx.workspaceId,
      issueId: target.id,
      actorId: ctx.actorId,
      source: ctx.source ?? null,
      field: `field:${f.id}`,
      fromValue: prev,
      toValue: next,
    });
  }
  return activity;
}
