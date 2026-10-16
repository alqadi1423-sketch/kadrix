import { auditLog, type Database } from "@veloq/db";

export type AuditAction =
  | "workspace.created"
  | "workspace.renamed"
  | "member.added"
  | "member.roleChanged"
  | "member.removed"
  | "member.projectsChanged"
  | "project.created"
  | "project.deleted"
  | "token.created"
  | "token.revoked"
  | "webhook.created"
  | "webhook.deleted"
  | "integration.connected"
  | "integration.disconnected"
  | "field.created"
  | "field.deleted"
  | "automation.created"
  | "automation.deleted"
  | "import.completed";

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
