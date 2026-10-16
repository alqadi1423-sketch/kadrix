import type { IssueFilter, IssueType, Role, StateCategory } from "@veloq/core";
import type { ErrorCode } from "@veloq/i18n";
import { createAuthClient } from "better-auth/react";
import { i18n } from "./i18n";

export const authClient = createAuthClient({ baseURL: window.location.origin });

/** Error carrying an API error code that maps to `errors.*` translations. */
export class ApiCallError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
  }
}

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: {
      "x-veloq-locale": i18n.language,
      ...(body && !isForm ? { "content-type": "application/json" } : {}),
    },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: ErrorCode } | null;
    throw new ApiCallError(data?.error ?? "generic");
  }
  return (await res.json()) as T;
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
}
export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
}
export interface AuditEntry {
  id: string;
  action: string;
  data: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
}
export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
}
export interface State {
  id: string;
  name: string;
  category: StateCategory;
  color: string;
  position: number;
  wipLimit: number | null;
}
export interface Label {
  id: string;
  name: string;
  color: string;
}
export interface Issue {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  number: number;
  type: IssueType;
  title: string;
  description?: string | null;
  stateId: string;
  stateName: string;
  stateCategory: StateCategory;
  stateColor: string;
  priority: number;
  assigneeId: string | null;
  assigneeName: string | null;
  parentId: string | null;
  cycleId: string | null;
  milestoneId: string | null;
  estimate: number | null;
  startDate: string | null;
  dueDate: string | null;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
  creatorId?: string | null;
}
export interface Relation {
  id: string;
  type: "blocks" | "relates" | "duplicates";
  issueId: string;
  relatedIssueId: string;
}
export interface Comment {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  editedAt: string | null;
}
export interface Activity {
  id: string;
  field: string;
  fromValue: unknown;
  toValue: unknown;
  createdAt: string;
  actorName: string | null;
}
export interface Attachment {
  id: string;
  fileName: string;
  size: number;
  createdAt: string;
  uploaderName: string | null;
}
export interface Notification {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  actorName: string | null;
  issueId: string | null;
  issueTitle: string | null;
  issueNumber: number | null;
  projectKey: string | null;
}
export interface SavedView {
  id: string;
  name: string;
  layout: "list" | "board" | "timeline" | "calendar";
  filter: IssueFilter;
  shared: boolean;
  ownerId: string;
}

const ws = (slug: string) => `/workspaces/${slug}`;

export const api = {
  me: () => call<{ user: { id: string; name: string; email: string } }>("GET", "/me"),
  workspaces: () => call<{ workspaces: WorkspaceSummary[] }>("GET", "/workspaces"),
  createWorkspace: (input: { name: string; slug: string }) =>
    call<{ workspace: WorkspaceSummary }>("POST", "/workspaces", input),
  workspace: (slug: string) => call<{ workspace: { slug: string; name: string; role: Role } }>("GET", ws(slug)),
  members: (slug: string) => call<{ members: Member[] }>("GET", `${ws(slug)}/members`),
  addMember: (slug: string, input: { email: string; role: Role }) => call("POST", `${ws(slug)}/members`, input),
  setRole: (slug: string, userId: string, role: Role) => call("PATCH", `${ws(slug)}/members/${userId}`, { role }),
  removeMember: (slug: string, userId: string) => call("DELETE", `${ws(slug)}/members/${userId}`),
  audit: (slug: string) => call<{ entries: AuditEntry[] }>("GET", `${ws(slug)}/audit`),

  projects: (slug: string) => call<{ projects: Project[] }>("GET", `${ws(slug)}/projects`),
  createProject: (slug: string, input: { name: string; key: string; description?: string }) =>
    call<{ project: Project }>("POST", `${ws(slug)}/projects`, input),
  project: (slug: string, id: string) => call<{ project: Project; states: State[] }>("GET", `${ws(slug)}/projects/${id}`),
  updateProject: (slug: string, id: string, patch: Partial<{ name: string; description: string; archived: boolean }>) =>
    call("PATCH", `${ws(slug)}/projects/${id}`, patch),
  createState: (slug: string, projectId: string, input: { name: string; category: StateCategory; color: string }) =>
    call("POST", `${ws(slug)}/projects/${projectId}/states`, input),
  updateState: (slug: string, projectId: string, id: string, patch: Partial<State>) =>
    call("PATCH", `${ws(slug)}/projects/${projectId}/states/${id}`, patch),
  deleteState: (slug: string, projectId: string, id: string, moveTo?: string) =>
    call("DELETE", `${ws(slug)}/projects/${projectId}/states/${id}${moveTo ? `?moveTo=${moveTo}` : ""}`),

  labels: (slug: string) => call<{ labels: Label[] }>("GET", `${ws(slug)}/labels`),
  createLabel: (slug: string, input: { name: string; color: string }) =>
    call<{ label: Label }>("POST", `${ws(slug)}/labels`, input),
  deleteLabel: (slug: string, id: string) => call("DELETE", `${ws(slug)}/labels/${id}`),

  issues: (slug: string, filter: IssueFilter) =>
    call<{ issues: Issue[] }>("GET", `${ws(slug)}/issues?filter=${encodeURIComponent(JSON.stringify(filter))}`),
  issueByKey: (slug: string, key: string) => call<{ issue: Issue }>("GET", `${ws(slug)}/issues/key/${key}`),
  issue: (slug: string, id: string) =>
    call<{ issue: Issue; children: Issue[]; relations: Relation[]; related: Issue[]; subscribed: boolean }>(
      "GET",
      `${ws(slug)}/issues/${id}`,
    ),
  createIssue: (slug: string, input: Record<string, unknown>) => call<{ issue: Issue }>("POST", `${ws(slug)}/issues`, input),
  updateIssue: (slug: string, id: string, patch: Record<string, unknown>) =>
    call<{ issue: Issue }>("PATCH", `${ws(slug)}/issues/${id}`, patch),
  bulkUpdate: (slug: string, ids: string[], patch: Record<string, unknown>) =>
    call("POST", `${ws(slug)}/issues/bulk`, { ids, patch }),
  deleteIssue: (slug: string, id: string) => call("DELETE", `${ws(slug)}/issues/${id}`),
  activity: (slug: string, id: string) => call<{ activity: Activity[] }>("GET", `${ws(slug)}/issues/${id}/activity`),
  comments: (slug: string, id: string) => call<{ comments: Comment[] }>("GET", `${ws(slug)}/issues/${id}/comments`),
  addComment: (slug: string, id: string, body: string) => call("POST", `${ws(slug)}/issues/${id}/comments`, { body }),
  editComment: (slug: string, id: string, body: string) => call("PATCH", `${ws(slug)}/comments/${id}`, { body }),
  deleteComment: (slug: string, id: string) => call("DELETE", `${ws(slug)}/comments/${id}`),
  addRelation: (slug: string, id: string, input: { type: Relation["type"]; relatedIssueId: string }) =>
    call("POST", `${ws(slug)}/issues/${id}/relations`, input),
  deleteRelation: (slug: string, id: string) => call("DELETE", `${ws(slug)}/relations/${id}`),
  subscribe: (slug: string, id: string, on: boolean) =>
    call(on ? "PUT" : "DELETE", `${ws(slug)}/issues/${id}/subscription`),
  attachments: (slug: string, id: string) =>
    call<{ attachments: Attachment[] }>("GET", `${ws(slug)}/issues/${id}/attachments`),
  upload: (slug: string, id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call("POST", `${ws(slug)}/issues/${id}/attachments`, form);
  },
  deleteAttachment: (slug: string, id: string) => call("DELETE", `${ws(slug)}/attachments/${id}`),
  attachmentUrl: (slug: string, id: string) => `/api${ws(slug)}/attachments/${id}`,

  notifications: (slug: string) => call<{ notifications: Notification[] }>("GET", `${ws(slug)}/notifications`),
  markRead: (slug: string, ids?: string[]) => call("POST", `${ws(slug)}/notifications/read`, { ids }),

  views: (slug: string) => call<{ views: SavedView[] }>("GET", `${ws(slug)}/views`),
  createView: (slug: string, input: Omit<SavedView, "id" | "ownerId">) =>
    call<{ view: SavedView }>("POST", `${ws(slug)}/views`, input),
  deleteView: (slug: string, id: string) => call("DELETE", `${ws(slug)}/views/${id}`),
};
