import { issue, projectAccess, workspace, workspaceMember, type Database } from "@veloq/db";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { Auth } from "./auth.js";
import type { EventBus } from "./events.js";

/**
 * GET /api/workspaces/:slug/live upgrades to a WebSocket that streams
 * change notices for one workspace. Membership is checked at connect time and
 * re-checked every minute so removed members stop receiving events.
 */
export function mountRealtime(
  app: Hono,
  upgradeWebSocket: UpgradeWebSocket,
  deps: { db: Database; auth: Auth; events: EventBus; baseUrl: string },
) {
  const { db, auth, events } = deps;
  const origin = new URL(deps.baseUrl).origin;

  /** Workspace id, plus the projects a guest may see (null for members). */
  async function membership(slug: string, userId: string) {
    const [row] = await db
      .select({ workspaceId: workspace.id, role: workspaceMember.role })
      .from(workspace)
      .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
      .where(and(eq(workspace.slug, slug), eq(workspaceMember.userId, userId)));
    if (!row) return null;
    if (row.role !== "guest") return { workspaceId: row.workspaceId, projects: null };
    const rows = await db.select({ id: projectAccess.projectId }).from(projectAccess).where(eq(projectAccess.userId, userId));
    return { workspaceId: row.workspaceId, projects: new Set(rows.map((r) => r.id)) };
  }

  app.get(
    "/api/workspaces/:slug/live",
    upgradeWebSocket(async (c) => {
      // Other sites must not open this socket with the visitor's cookie.
      const o = c.req.header("origin");
      const allowed = !o || o === origin;
      const session = allowed ? await auth.api.getSession({ headers: c.req.raw.headers }) : null;
      const userId = session?.user.id ?? null;
      const slug = c.req.param("slug") ?? "";
      let access = userId ? await membership(slug, userId) : null;
      const workspaceId = access?.workspaceId ?? null;
      const projectOf = new Map<string, string | null>();
      /** Guests only hear about issues in their projects, and no other ids. */
      async function visible(e: { entity: string; id?: string | null }) {
        if (!access?.projects) return { entity: e.entity, id: e.id ?? null };
        if ((e.entity === "issue" || e.entity === "comment") && e.id) {
          if (!projectOf.has(e.id)) {
            const [row] = await db.select({ projectId: issue.projectId }).from(issue).where(eq(issue.id, e.id));
            projectOf.set(e.id, row?.projectId ?? null);
          }
          const p = projectOf.get(e.id);
          return p && access.projects.has(p) ? { entity: e.entity, id: e.id } : null;
        }
        return { entity: e.entity, id: null };
      }
      let unsubscribe: (() => void) | null = null;
      let timer: ReturnType<typeof setInterval> | null = null;

      return {
        onOpen(_evt, ws) {
          if (!userId || !workspaceId) {
            ws.close(4401, "unauthorized");
            return;
          }
          unsubscribe = events.subscribe((e) => {
            if (e.workspaceId !== workspaceId) return;
            if (e.userId && e.userId !== userId) return;
            void visible(e)
              .then((v) => v && ws.send(JSON.stringify(v)))
              .catch(() => {});
          });
          timer = setInterval(async () => {
            access = await membership(slug, userId).catch(() => null);
            projectOf.clear();
            if (!access) ws.close(4403, "forbidden");
            else ws.send(JSON.stringify({ entity: "ping" }));
          }, 60_000);
        },
        onClose() {
          unsubscribe?.();
          if (timer) clearInterval(timer);
        },
      };
    }),
  );
}
