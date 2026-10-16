import type { IssueFilter, IssueType, Role, StateCategory } from "@kadrix/core";

/**
 * Platform-neutral Kadrix API client. It only needs `fetch`, so the same
 * code runs in React Native, Node scripts, browsers and edge functions.
 * Authenticate with an API token (mobile and scripts) or, in a browser on
 * the same origin, with the session cookie.
 */

export interface ClientOptions {
  /** Server address, e.g. https://kadrix.example.com */
  baseUrl: string;
  /** API token (kdx_...). Leave out to use cookies in a browser. */
  token?: string;
  /** "ar" or "en": language for server-made text such as default state names. */
  locale?: "ar" | "en";
  fetch?: typeof fetch;
}

export class KadrixError extends Error {
  constructor(
    public readonly status: number,
    /** Stable code; translate it with the `errors.*` messages of @kadrix/i18n. */
    public readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  role: Role;
}
export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
}
export interface WorkflowState {
  id: string;
  name: string;
  category: StateCategory;
  color: string;
  position: number;
}
export interface Issue {
  id: string;
  key: string;
  projectId: string;
  number: number;
  title: string;
  description: string | null;
  type: IssueType;
  priority: number;
  stateId: string;
  stateName: string;
  stateCategory: StateCategory;
  assigneeId: string | null;
  assigneeName: string | null;
  labelIds: string[];
  dueDate: string | null;
  estimate: number | null;
  updatedAt: string;
}
export interface Comment {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  source?: string | null;
  createdAt: string;
}
export interface Notification {
  id: string;
  kind: string;
  issueId: string | null;
  readAt: string | null;
  createdAt: string;
}

export type NewIssue = {
  projectId: string;
  title: string;
  description?: string;
  type?: IssueType;
  priority?: number;
  assigneeId?: string | null;
  labelIds?: string[];
  parentId?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
};
export type IssuePatch = Partial<Omit<NewIssue, "projectId">> & { stateId?: string; fields?: Record<string, unknown> };

export function createClient(opts: ClientOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const base = opts.baseUrl.replace(/\/$/, "");

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base}/api${path}`, {
      method,
      credentials: opts.token ? "omit" : "include",
      headers: {
        accept: "application/json",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.locale ? { "x-kadrix-locale": opts.locale } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) throw new KadrixError(res.status, data?.error ?? "generic");
    return data as T;
  }
  const ws = (slug: string) => `/workspaces/${encodeURIComponent(slug)}`;

  return {
    call,
    health: () => call<{ ok: boolean; edition: string; version: string }>("GET", "/health"),
    me: () => call<{ user: { id: string; name: string; email: string } }>("GET", "/me"),
    workspaces: () => call<{ workspaces: Workspace[] }>("GET", "/workspaces").then((d) => d.workspaces),
    projects: (slug: string) => call<{ projects: Project[] }>("GET", `${ws(slug)}/projects`).then((d) => d.projects),
    project: (slug: string, id: string) => call<{ project: Project; states: WorkflowState[] }>("GET", `${ws(slug)}/projects/${id}`),
    issues: (slug: string, filter: IssueFilter = {}, page: { limit?: number; offset?: number } = {}) =>
      call<{ issues: Issue[] }>(
        "GET",
        `${ws(slug)}/issues?filter=${encodeURIComponent(JSON.stringify(filter))}&limit=${page.limit ?? 100}&offset=${page.offset ?? 0}`,
      ).then((d) => d.issues),
    issueByKey: (slug: string, key: string) => call<{ issue: Issue }>("GET", `${ws(slug)}/issues/key/${encodeURIComponent(key)}`).then((d) => d.issue),
    createIssue: (slug: string, input: NewIssue) => call<{ issue: Issue }>("POST", `${ws(slug)}/issues`, input).then((d) => d.issue),
    updateIssue: (slug: string, id: string, patch: IssuePatch) => call<{ issue: Issue }>("PATCH", `${ws(slug)}/issues/${id}`, patch).then((d) => d.issue),
    comments: (slug: string, issueId: string) => call<{ comments: Comment[] }>("GET", `${ws(slug)}/issues/${issueId}/comments`).then((d) => d.comments),
    addComment: (slug: string, issueId: string, body: string) => call<{ comment: Comment }>("POST", `${ws(slug)}/issues/${issueId}/comments`, { body }).then((d) => d.comment),
    notifications: (slug: string) => call<{ notifications: Notification[] }>("GET", `${ws(slug)}/notifications`).then((d) => d.notifications),
    markRead: (slug: string, ids?: string[]) => call("POST", `${ws(slug)}/notifications/read`, { ids }),
    logTime: (slug: string, issueId: string, minutes: number, date: string, note = "") => call("POST", `${ws(slug)}/issues/${issueId}/time`, { minutes, date, note }),
  };
}

export type KadrixClient = ReturnType<typeof createClient>;

/** Live updates: the URL to open a WebSocket on for a workspace. */
export function liveUrl(baseUrl: string, slug: string) {
  const u = new URL(`/api/workspaces/${encodeURIComponent(slug)}/live`, baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
