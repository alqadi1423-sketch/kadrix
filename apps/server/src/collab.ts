import { Hocuspocus } from "@hocuspocus/server";
import { can, type Role } from "@veloq/core";
import { page, projectAccess, workspace, workspaceMember, type Database } from "@veloq/db";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import * as Y from "yjs";
import type { Auth } from "./auth.js";
import type { EventBus } from "./events.js";
import { syncPageIssues } from "./routes/pages.js";

interface CollabContext {
  userId: string;
  workspaceId: string;
  pageId: string;
  readOnly: boolean;
}

const BLOCKS = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock", "taskItem", "tableCell"]);

/** Plain text of a Tiptap/Yjs document, one block per line, for search and issue links. */
export function ydocToText(doc: Y.Doc): string {
  const out: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment | Y.XmlHook) => {
    if (node instanceof Y.XmlText) {
      for (const op of node.toDelta() as { insert: unknown }[]) if (typeof op.insert === "string") out.push(op.insert);
      return;
    }
    if (node instanceof Y.XmlElement && node.nodeName === "hardBreak") {
      out.push("\n");
      return;
    }
    if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
      for (const child of node.toArray()) walk(child as Y.XmlElement);
      if (node instanceof Y.XmlElement && BLOCKS.has(node.nodeName)) out.push("\n");
    }
  };
  walk(doc.getXmlFragment("default"));
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Live co-editing of pages with Yjs (CRDT) through Hocuspocus, mounted on
 * the same HTTP server: GET /api/workspaces/:slug/pages/:id/collab upgrades
 * to a WebSocket. Access is checked from the session cookie before the
 * document opens; guests and read-only roles join without write access.
 * The document is saved (debounced) as binary state plus plain text.
 */
export function mountCollab(app: Hono, upgradeWebSocket: UpgradeWebSocket, deps: { db: Database; auth: Auth; events: EventBus; baseUrl: string }) {
  const { db, auth, events } = deps;

  const hocuspocus = new Hocuspocus<CollabContext>({
    debounce: 1500,
    maxDebounce: 10_000,
    async onConnect({ context, connectionConfig, documentName }) {
      // The client names the document; it must be the page this socket was
      // authorized for, or one connection could open any page.
      if (documentName !== `page:${context.pageId}`) throw new Error("forbidden");
      connectionConfig.readOnly = context.readOnly;
    },
    async onLoadDocument({ document, context }) {
      const [row] = await db.select({ ydoc: page.ydoc }).from(page).where(eq(page.id, context.pageId));
      if (row?.ydoc) Y.applyUpdate(document, new Uint8Array(row.ydoc));
      return document;
    },
    async onStoreDocument({ document, lastContext: context }) {
      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      const text = ydocToText(document);
      await db
        .update(page)
        .set({ ydoc: state, contentText: text, updatedBy: context.userId })
        .where(eq(page.id, context.pageId));
      await syncPageIssues(db, context.workspaceId, context.pageId, text);
      await events.publish({ workspaceId: context.workspaceId, entity: "page", id: context.pageId }).catch(() => {});
    },
  });

  async function authorize(headers: Headers, slug: string, pageId: string): Promise<CollabContext | null> {
    const s = await auth.api.getSession({ headers });
    if (!s) return null;
    const [m] = await db
      .select({ workspaceId: workspace.id, role: workspaceMember.role })
      .from(workspace)
      .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
      .where(and(eq(workspace.slug, slug), eq(workspaceMember.userId, s.user.id)));
    if (!m || !can(m.role as Role, "issue.read")) return null;
    const [p] = await db
      .select({ id: page.id, projectId: page.projectId })
      .from(page)
      .where(and(eq(page.id, pageId), eq(page.workspaceId, m.workspaceId)));
    if (!p) return null;
    if (m.role === "guest") {
      if (!p.projectId) return null;
      const [ok] = await db
        .select({ id: projectAccess.projectId })
        .from(projectAccess)
        .where(and(eq(projectAccess.projectId, p.projectId), eq(projectAccess.userId, s.user.id)));
      if (!ok) return null;
    }
    return { userId: s.user.id, workspaceId: m.workspaceId, pageId: p.id, readOnly: !can(m.role as Role, "issue.create") };
  }

  app.get(
    "/api/workspaces/:slug/pages/:pageId/collab",
    upgradeWebSocket(async (c) => {
      // Other sites must not open this socket with the visitor's cookie.
      const o = c.req.header("origin");
      const ctx = o && o !== new URL(deps.baseUrl).origin ? null : await authorize(c.req.raw.headers, c.req.param("slug") ?? "", c.req.param("pageId") ?? "").catch(() => null);
      let conn: ReturnType<Hocuspocus["handleConnection"]> | null = null;
      return {
        onOpen(_evt, ws) {
          if (!ctx) {
            ws.close(4401, "unauthorized");
            return;
          }
          const raw = ws.raw as { binaryType?: string } | undefined;
          if (raw) raw.binaryType = "arraybuffer";
          conn = hocuspocus.handleConnection(
            {
              send: (data) => ws.send(data as ArrayBuffer),
              close: (code, reason) => ws.close(code, reason),
              get readyState() {
                return ws.readyState;
              },
            },
            c.req.raw,
            ctx,
          );
        },
        onMessage(evt) {
          const d = evt.data;
          const bytes =
            d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : null;
          if (bytes && conn) conn.handleMessage(bytes);
        },
        onClose() {
          conn?.handleClose();
        },
      };
    }),
  );

  return hocuspocus;
}
