import { workspace, workspaceMember, type Database } from "@veloq/db";
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
  deps: { db: Database; auth: Auth; events: EventBus },
) {
  const { db, auth, events } = deps;

  async function membership(slug: string, userId: string) {
    const [row] = await db
      .select({ workspaceId: workspace.id })
      .from(workspace)
      .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
      .where(and(eq(workspace.slug, slug), eq(workspaceMember.userId, userId)));
    return row?.workspaceId ?? null;
  }

  app.get(
    "/api/workspaces/:slug/live",
    upgradeWebSocket(async (c) => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      const userId = session?.user.id ?? null;
      const slug = c.req.param("slug") ?? "";
      const workspaceId = userId ? await membership(slug, userId) : null;
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
            ws.send(JSON.stringify({ entity: e.entity, id: e.id ?? null }));
          });
          timer = setInterval(async () => {
            if (!(await membership(slug, userId).catch(() => null))) ws.close(4403, "forbidden");
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
