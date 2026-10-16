import { PRIORITY_KEYS, STATE_CATEGORIES, parseDuration } from "@veloq/core";
import { workspace, type Database } from "@veloq/db";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Env } from "./context.js";

/**
 * Model Context Protocol server (Streamable HTTP, stateless JSON responses)
 * so AI coding agents can read and update work in Veloq.
 *
 * Every tool is a thin call into the public REST API with the caller's own
 * token, so agents get exactly the permissions, guest limits, validation,
 * history and webhooks a person with that token would. Nothing here can do
 * more than the API already allows.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; data: unknown }>;

interface Tool {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  readOnly: boolean;
  run: (args: Record<string, unknown>, call: Call, slug: string) => Promise<unknown>;
}

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,5}-\d+$/).describe("Issue key, e.g. WEB-12");

async function issueId(call: Call, slug: string, k: string) {
  const r = await call("GET", `/workspaces/${slug}/issues/key/${encodeURIComponent(k.toUpperCase())}`);
  if (r.status !== 200) throw new ToolError(`No issue ${k}`);
  return (r.data as { issue: { id: string } }).issue.id;
}

class ToolError extends Error {}

function ok(r: { status: number; data: unknown }) {
  if (r.status >= 400) {
    const code = (r.data as { error?: string } | null)?.error ?? "error";
    throw new ToolError(`Request failed (${r.status} ${code})`);
  }
  return r.data;
}

export const TOOLS: Tool[] = [
  {
    name: "list_projects",
    title: "List projects",
    description: "Projects in this workspace with their keys.",
    input: z.object({}),
    readOnly: true,
    run: async (_a, call, slug) => ok(await call("GET", `/workspaces/${slug}/projects`)),
  },
  {
    name: "list_states",
    title: "List workflow states",
    description: "Workflow states of a project. Use a state id with update_issue to move work.",
    input: z.object({ projectId: z.string().uuid() }),
    readOnly: true,
    run: async (a, call, slug) => {
      const d = ok(await call("GET", `/workspaces/${slug}/projects/${a.projectId}`)) as { states: unknown };
      return { states: d.states };
    },
  },
  {
    name: "list_members",
    title: "List members",
    description: "People and agents in the workspace, for assigning issues.",
    input: z.object({}),
    readOnly: true,
    run: async (_a, call, slug) => ok(await call("GET", `/workspaces/${slug}/members`)),
  },
  {
    name: "search_issues",
    title: "Search issues",
    description: "Find issues by text (Arabic or English), project, status group, or assignee. Closed issues are left out unless includeClosed is true.",
    input: z.object({
      query: z.string().max(200).optional(),
      projectId: z.string().uuid().optional(),
      stateCategory: z.array(z.enum(STATE_CATEGORIES)).optional(),
      assignedToMe: z.boolean().optional(),
      includeClosed: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    readOnly: true,
    run: async (a, call, slug) => {
      let assigneeId: string[] | undefined;
      if (a.assignedToMe) assigneeId = [((ok(await call("GET", "/me")) as { user: { id: string } }).user.id)];
      const filter = { search: a.query, projectId: a.projectId, stateCategory: a.stateCategory, assigneeId, includeClosed: a.includeClosed };
      const d = ok(await call("GET", `/workspaces/${slug}/issues?limit=${a.limit ?? 25}&filter=${encodeURIComponent(JSON.stringify(filter))}`)) as {
        issues: Record<string, unknown>[];
      };
      return {
        issues: d.issues.map((i) => ({
          key: i.key,
          title: i.title,
          state: i.stateName,
          stateCategory: i.stateCategory,
          priority: PRIORITY_KEYS[Number(i.priority)] ?? "none",
          assignee: i.assigneeName ?? null,
          dueDate: i.dueDate ?? null,
        })),
      };
    },
  },
  {
    name: "get_issue",
    title: "Get issue",
    description: "Full issue with description, sub-issues, relations and comments.",
    input: z.object({ key }),
    readOnly: true,
    run: async (a, call, slug) => {
      const id = await issueId(call, slug, String(a.key));
      const detail = ok(await call("GET", `/workspaces/${slug}/issues/${id}`)) as Record<string, unknown>;
      const comments = ok(await call("GET", `/workspaces/${slug}/issues/${id}/comments`)) as { comments: unknown[] };
      return { ...detail, comments: comments.comments };
    },
  },
  {
    name: "create_issue",
    title: "Create issue",
    description: "Create an issue in a project. Returns its key.",
    input: z.object({
      projectId: z.string().uuid(),
      title: z.string().min(1).max(250),
      description: z.string().max(100_000).optional(),
      type: z.enum(["task", "bug", "feature", "epic"]).optional(),
      priority: z.number().int().min(0).max(4).optional().describe("0 none, 1 urgent, 2 high, 3 medium, 4 low"),
      assigneeId: z.string().nullable().optional(),
      parentKey: key.optional(),
      labelIds: z.array(z.string().uuid()).optional(),
    }),
    readOnly: false,
    run: async (a, call, slug) => {
      const { parentKey, ...rest } = a;
      const parentId = parentKey ? await issueId(call, slug, String(parentKey)) : undefined;
      const d = ok(await call("POST", `/workspaces/${slug}/issues`, { ...rest, parentId })) as { issue: { key: string; id: string } };
      return { key: d.issue.key, id: d.issue.id };
    },
  },
  {
    name: "update_issue",
    title: "Update issue",
    description: "Change an issue's title, description, state, priority, assignee, labels, estimate or dates. Only the fields you pass change.",
    input: z.object({
      key,
      title: z.string().min(1).max(250).optional(),
      description: z.string().max(100_000).optional(),
      stateId: z.string().uuid().optional(),
      priority: z.number().int().min(0).max(4).optional(),
      assigneeId: z.string().nullable().optional(),
      labelIds: z.array(z.string().uuid()).optional(),
      estimate: z.number().min(0).max(1000).nullable().optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }),
    readOnly: false,
    run: async (a, call, slug) => {
      const { key: k, ...patch } = a;
      const id = await issueId(call, slug, String(k));
      const d = ok(await call("PATCH", `/workspaces/${slug}/issues/${id}`, patch)) as { issue: { key: string; stateName: string } };
      return { key: d.issue.key, state: d.issue.stateName };
    },
  },
  {
    name: "add_comment",
    title: "Comment on issue",
    description: "Add a Markdown comment to an issue.",
    input: z.object({ key, body: z.string().min(1).max(50_000) }),
    readOnly: false,
    run: async (a, call, slug) => {
      const id = await issueId(call, slug, String(a.key));
      ok(await call("POST", `/workspaces/${slug}/issues/${id}/comments`, { body: a.body }));
      return { ok: true };
    },
  },
  {
    name: "log_time",
    title: "Log time",
    description: 'Record time spent on an issue, e.g. duration "1h 30m" or "45m".',
    input: z.object({ key, duration: z.string().max(40), note: z.string().max(500).optional() }),
    readOnly: false,
    run: async (a, call, slug) => {
      const minutes = parseDuration(String(a.duration));
      if (!minutes) throw new ToolError("Duration not understood; use forms like 45m or 1h 30m");
      const id = await issueId(call, slug, String(a.key));
      ok(await call("POST", `/workspaces/${slug}/issues/${id}/time`, { minutes, date: new Date().toISOString().slice(0, 10), note: a.note ?? "" }));
      return { minutes };
    },
  },
  {
    name: "search_docs",
    title: "Search docs",
    description: "Find pages in the workspace docs by text.",
    input: z.object({ query: z.string().min(1).max(200) }),
    readOnly: true,
    run: async (a, call, slug) => ok(await call("GET", `/workspaces/${slug}/pages?q=${encodeURIComponent(String(a.query))}`)),
  },
];

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } });

export function mountMcp(app: Hono<Env>, deps: { db: Database; baseUrl: string; version: string }) {
  app.get("/mcp", (c) => c.body(null, 405, { allow: "POST" }));
  app.delete("/mcp", (c) => c.body(null, 405, { allow: "POST" }));

  app.post("/mcp", async (c: Context<Env>) => {
    // Browsers must not be able to drive the endpoint from other sites.
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(deps.baseUrl).origin) return c.json(rpcError(null, -32600, "Origin not allowed"), 403);
    const wsId = c.get("tokenWorkspaceId");
    if (!c.get("user") || !wsId) {
      c.header("www-authenticate", 'Bearer realm="veloq"');
      return c.json(rpcError(null, -32001, "Use an API token: Authorization: Bearer vlq_..."), 401);
    }
    const msg = (await c.req.json().catch(() => null)) as RpcRequest | null;
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return c.json(rpcError(null, -32700, "Parse error"), 400);
    // Notifications (no id) get no response body.
    if (msg.id === undefined) return c.body(null, 202);

    const [ws] = await deps.db.select({ slug: workspace.slug, name: workspace.name }).from(workspace).where(eq(workspace.id, wsId));
    if (!ws) return c.json(rpcError(msg.id, -32001, "Workspace not found"));
    const auth = c.req.header("authorization")!;
    const locale = c.req.header("x-veloq-locale") ?? "en";
    const call: Call = async (method, path, body) => {
      const res = await app.request(`/api${path}`, {
        method,
        headers: { authorization: auth, "x-veloq-locale": locale, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    const writable = (c.get("tokenScopes") ?? []).includes("write");

    switch (msg.method) {
      case "initialize": {
        const asked = String(msg.params?.protocolVersion ?? "");
        return c.json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "veloq", title: "Veloq", version: deps.version },
            instructions: `Workspace "${ws.name}". Issues are referred to by keys like WEB-12. Use search_issues to find work, get_issue for details, and update_issue to move an issue (get state ids from list_states).${writable ? "" : " This token is read-only."}`,
          },
        });
      }
      case "ping":
        return c.json({ jsonrpc: "2.0", id: msg.id, result: {} });
      case "tools/list":
        return c.json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: TOOLS.filter((t) => writable || t.readOnly).map((t) => ({
              name: t.name,
              title: t.title,
              description: t.description,
              inputSchema: z.toJSONSchema(t.input, { io: "input" }),
              annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false },
            })),
          },
        });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === msg.params?.name);
        if (!tool || (!writable && !tool.readOnly)) return c.json(rpcError(msg.id, -32602, `Unknown tool: ${String(msg.params?.name)}`));
        const args = tool.input.safeParse(msg.params?.arguments ?? {});
        if (!args.success) {
          return c.json({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: `Invalid arguments: ${args.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}` }] } });
        }
        try {
          const out = await tool.run(args.data as Record<string, unknown>, call, ws.slug);
          return c.json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out } });
        } catch (e) {
          const text = e instanceof ToolError ? e.message : "Tool failed";
          return c.json({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text }] } });
        }
      }
      default:
        return c.json(rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
    }
  });
}
