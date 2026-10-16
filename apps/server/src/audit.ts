import { auditLog, type Database } from "@veloq/db";

export type AuditAction =
  | "workspace.created"
  | "member.added"
  | "member.roleChanged"
  | "member.removed";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function recordAudit(
  db: Database | Tx,
  entry: {
    workspaceId: string;
    actorId: string;
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    data?: Record<string, unknown>;
  },
) {
  await db.insert(auditLog).values({
    workspaceId: entry.workspaceId,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    data: entry.data ?? {},
  });
}
