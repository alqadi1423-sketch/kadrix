import type { AutomationAction, AutomationTrigger, Condition, CsvMapping, FieldKind, IssueFilter, IssueType, Role, StateCategory } from "@kadrix/core";
import type { ErrorCode } from "@kadrix/i18n";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { i18n } from "./i18n";

export const authClient = createAuthClient({ baseURL: window.location.origin, plugins: [twoFactorClient()] });

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
      "x-kadrix-locale": i18n.language,
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
  kind?: "human" | "agent";
  /** Guests only: the projects they can see. */
  projectIds?: string[] | null;
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
  source?: string | null;
  createdAt: string;
  editedAt: string | null;
}
export interface Activity {
  id: string;
  field: string;
  source: string | null;
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

export interface Cycle {
  id: string;
  number: number;
  name: string | null;
  startsOn: string;
  endsOn: string;
  completedAt: string | null;
  status: "active" | "upcoming" | "completed" | "overdue";
  total: number;
  done: number;
  points: number;
  donePoints: number;
}
export interface Milestone {
  id: string;
  name: string;
  description: string | null;
  targetDate: string | null;
  total: number;
  done: number;
}
export interface Initiative {
  id: string;
  name: string;
  description: string | null;
  targetDate: string | null;
  ownerName: string | null;
  projectIds: string[];
  total: number;
  done: number;
  health: "onTrack" | "atRisk" | "offTrack" | null;
}
export interface StatusUpdate {
  id: string;
  health: "onTrack" | "atRisk" | "offTrack";
  body: string;
  createdAt: string;
  authorName: string | null;
}
export interface Timeline {
  issues: Issue[];
  undated: number;
  dependencies: { from: string; to: string }[];
  milestones: { id: string; name: string; targetDate: string | null }[];
  criticalPath: string[];
  criticalLength: number;
  weekend: number[];
}

export interface IssueLink {
  id: string;
  provider: string;
  kind: "pull_request" | "commit" | "branch";
  url: string;
  title: string | null;
  state: string | null;
  updatedAt: string;
}
export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  format: string;
  locale: string;
  active: boolean;
  failing: number;
}
export interface Delivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}
export interface PrMapping {
  draft: "started" | "completed" | null;
  open: "started" | "completed" | null;
  reviewRequested: "started" | "completed" | null;
  merged: "started" | "completed" | null;
  closed: "started" | "completed" | null;
  reviewStateName: string | null;
}
export interface Integration {
  id: string;
  provider: "github" | "gitlab";
  name: string;
  endpoint: string;
  lastEventAt: string | null;
  config: PrMapping;
}
export interface Release {
  id: string;
  version: string;
  name: string | null;
  notes: string | null;
  releasedAt: string | null;
  createdAt: string;
  issueCount: number;
}

export interface PageSummary {
  id: string;
  title: string;
  projectId: string | null;
  parentId: string | null;
  position: number;
  updatedAt: string;
  updatedByName: string | null;
}

export interface CustomField {
  id: string;
  name: string;
  kind: FieldKind;
  projectId: string | null;
  options: { id: string; name: string; color?: string }[];
}
export interface IssueTemplate {
  id: string;
  projectId: string;
  name: string;
  title: string;
  description: string;
  defaults: { type?: IssueType; priority?: number; estimate?: number | null; assigneeId?: string | null; labelIds?: string[]; fields?: Record<string, unknown> };
}
export interface RecurrenceRow {
  id: string;
  templateId: string;
  templateName: string;
  projectId: string;
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  weekdays: number[];
  dayOfMonth: number | null;
  startDate: string;
  nextDate: string;
  lastDate: string | null;
  active: boolean;
}
export interface AutomationRuleRow {
  id: string;
  name: string;
  projectId: string | null;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: AutomationAction[];
  active: boolean;
  runCount: number;
  lastRunAt: string | null;
  lastError: string | null;
}
export interface TimeEntryRow {
  id: string;
  minutes: number;
  date: string;
  note: string;
  userId: string | null;
  userName: string | null;
}
export interface Report {
  range: { from: string; to: string };
  flow: { completed: number; leadP50: number | null; leadP85: number | null; cycleP50: number | null; cycleP85: number | null };
  throughput: { weekEnding: string; done: number }[];
  cfd: ({ date: string } & Record<StateCategory, number>)[];
  workload: { userId: string | null; name: string | null; open: number; estimate: number }[];
  time: { userId: string | null; name: string | null; minutes: number }[];
}
export type ImportInput =
  | { source: "csv"; projectId: string; csv: string; mapping: CsvMapping }
  | { source: "jira" | "linear"; projectId: string; csv: string }
  | { source: "github"; projectId: string; repo: string; token?: string };

const ws = (slug: string) => `/workspaces/${slug}`;

export const api = {
  me: () => call<{ user: { id: string; name: string; email: string } }>("GET", "/me"),
  workspaces: () => call<{ workspaces: WorkspaceSummary[] }>("GET", "/workspaces"),
  createWorkspace: (input: { name: string; slug: string }) =>
    call<{ workspace: WorkspaceSummary }>("POST", "/workspaces", input),
  workspace: (slug: string) =>
    call<{ workspace: { slug: string; name: string; role: Role; weekendDays: number[] } }>("GET", ws(slug)),
  updateWorkspace: (slug: string, patch: { name?: string; weekendDays?: number[] }) => call("PATCH", ws(slug), patch),
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

  cycles: (slug: string, projectId: string) =>
    call<{ cycles: Cycle[]; velocity: number | null }>("GET", `${ws(slug)}/projects/${projectId}/cycles`),
  createCycle: (slug: string, projectId: string, input: { name?: string; startsOn: string; endsOn: string }) =>
    call<{ cycle: Cycle }>("POST", `${ws(slug)}/projects/${projectId}/cycles`, input),
  completeCycle: (slug: string, id: string) =>
    call<{ rolledOver: number; movedTo: string | null }>("POST", `${ws(slug)}/cycles/${id}/complete`, {}),
  deleteCycle: (slug: string, id: string) => call("DELETE", `${ws(slug)}/cycles/${id}`),
  burndown: (slug: string, id: string) =>
    call<{ unit: "points" | "issues"; points: { date: string; scope: number; remaining: number; ideal: number }[]; workingDays: number }>(
      "GET",
      `${ws(slug)}/cycles/${id}/burndown`,
    ),
  milestones: (slug: string, projectId: string) =>
    call<{ milestones: Milestone[] }>("GET", `${ws(slug)}/projects/${projectId}/milestones`),
  createMilestone: (slug: string, projectId: string, input: { name: string; targetDate?: string | null }) =>
    call("POST", `${ws(slug)}/projects/${projectId}/milestones`, input),
  deleteMilestone: (slug: string, id: string) => call("DELETE", `${ws(slug)}/milestones/${id}`),
  timeline: (slug: string, projectId: string) => call<Timeline>("GET", `${ws(slug)}/projects/${projectId}/timeline`),
  calendar: (slug: string, from: string, to: string, projectId?: string) =>
    call<{ issues: Issue[]; milestones: { id: string; name: string; targetDate: string }[] }>(
      "GET",
      `${ws(slug)}/calendar?from=${from}&to=${to}${projectId ? `&projectId=${projectId}` : ""}`,
    ),
  initiatives: (slug: string) => call<{ initiatives: Initiative[] }>("GET", `${ws(slug)}/initiatives`),
  createInitiative: (slug: string, input: { name: string; description?: string; targetDate?: string | null; projectIds: string[] }) =>
    call("POST", `${ws(slug)}/initiatives`, input),
  updateInitiative: (slug: string, id: string, patch: Record<string, unknown>) => call("PATCH", `${ws(slug)}/initiatives/${id}`, patch),
  deleteInitiative: (slug: string, id: string) => call("DELETE", `${ws(slug)}/initiatives/${id}`),
  updates: (slug: string, q: { initiativeId?: string; projectId?: string }) =>
    call<{ updates: StatusUpdate[] }>(
      "GET",
      `${ws(slug)}/updates?${q.initiativeId ? `initiativeId=${q.initiativeId}` : `projectId=${q.projectId}`}`,
    ),
  postUpdate: (slug: string, input: { initiativeId?: string; projectId?: string; health: StatusUpdate["health"]; body: string }) =>
    call("POST", `${ws(slug)}/updates`, input),

  links: (slug: string, id: string) => call<{ links: IssueLink[]; branch: string }>("GET", `${ws(slug)}/issues/${id}/links`),
  tokens: (slug: string) => call<{ tokens: ApiToken[] }>("GET", `${ws(slug)}/tokens`),
  createToken: (slug: string, input: { name: string; scopes: string[]; expiresInDays?: number | null }) =>
    call<{ token: ApiToken & { value: string } }>("POST", `${ws(slug)}/tokens`, input),
  revokeToken: (slug: string, id: string) => call("DELETE", `${ws(slug)}/tokens/${id}`),
  webhooks: (slug: string) => call<{ webhooks: Webhook[] }>("GET", `${ws(slug)}/webhooks`),
  createWebhook: (slug: string, input: { url: string; events: string[]; format?: string; locale?: string }) =>
    call<{ webhook: Webhook & { secret: string } }>("POST", `${ws(slug)}/webhooks`, input),
  updateWebhook: (slug: string, id: string, patch: Partial<{ url: string; events: string[]; active: boolean }>) =>
    call("PATCH", `${ws(slug)}/webhooks/${id}`, patch),
  deleteWebhook: (slug: string, id: string) => call("DELETE", `${ws(slug)}/webhooks/${id}`),
  deliveries: (slug: string, id: string) => call<{ deliveries: Delivery[] }>("GET", `${ws(slug)}/webhooks/${id}/deliveries`),
  pingWebhook: (slug: string, id: string) => call("POST", `${ws(slug)}/webhooks/${id}/ping`),
  integrations: (slug: string) => call<{ integrations: Integration[] }>("GET", `${ws(slug)}/integrations`),
  createIntegration: (slug: string, input: { provider: "github" | "gitlab"; name: string }) =>
    call<{ integration: Integration & { secret: string } }>("POST", `${ws(slug)}/integrations`, input),
  updateIntegration: (slug: string, id: string, config: PrMapping) => call("PATCH", `${ws(slug)}/integrations/${id}`, config),
  deleteIntegration: (slug: string, id: string) => call("DELETE", `${ws(slug)}/integrations/${id}`),
  releases: (slug: string, projectId: string) => call<{ releases: Release[] }>("GET", `${ws(slug)}/projects/${projectId}/releases`),
  releaseDraft: (slug: string, projectId: string) =>
    call<{ issues: Issue[] }>("GET", `${ws(slug)}/projects/${projectId}/releases/draft`),
  createRelease: (slug: string, projectId: string, input: { version: string; name?: string | null; notes?: string | null; issueIds: string[] }) =>
    call<{ release: Release }>("POST", `${ws(slug)}/projects/${projectId}/releases`, input),
  publishRelease: (slug: string, id: string) => call("POST", `${ws(slug)}/releases/${id}/publish`),
  deleteRelease: (slug: string, id: string) => call("DELETE", `${ws(slug)}/releases/${id}`),

  pages: (slug: string, q?: string) =>
    call<{ pages: PageSummary[] }>("GET", `${ws(slug)}/pages${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  page: (slug: string, id: string) =>
    call<{ page: PageSummary & { contentText: string }; issues: { id: string; key: string; title: string }[] }>("GET", `${ws(slug)}/pages/${id}`),
  createPage: (slug: string, input: { title: string; projectId?: string | null; parentId?: string | null }) =>
    call<{ page: PageSummary }>("POST", `${ws(slug)}/pages`, input),
  updatePage: (slug: string, id: string, patch: { title?: string; parentId?: string | null; position?: number }) =>
    call("PATCH", `${ws(slug)}/pages/${id}`, patch),
  deletePage: (slug: string, id: string) => call("DELETE", `${ws(slug)}/pages/${id}`),
  issuePages: (slug: string, issueId: string) =>
    call<{ pages: { id: string; title: string; updatedAt: string }[] }>("GET", `${ws(slug)}/issues/${issueId}/pages`),
  setGuestProjects: (slug: string, userId: string, projectIds: string[]) =>
    call("PUT", `${ws(slug)}/members/${userId}/projects`, { projectIds }),
  preferences: () => call<{ preferences: { locale: "ar" | "en"; emailDigest: boolean } }>("GET", "/me/preferences"),
  setPreferences: (patch: { locale?: "ar" | "en"; emailDigest?: boolean }) => call("PATCH", "/me/preferences", patch),

  fields: (slug: string, projectId?: string) =>
    call<{ fields: CustomField[] }>("GET", `${ws(slug)}/fields${projectId ? `?projectId=${projectId}` : ""}`),
  createField: (slug: string, input: Omit<CustomField, "id">) => call<{ field: CustomField }>("POST", `${ws(slug)}/fields`, input),
  updateField: (slug: string, id: string, patch: Partial<Pick<CustomField, "name" | "options">>) => call("PATCH", `${ws(slug)}/fields/${id}`, patch),
  deleteField: (slug: string, id: string) => call("DELETE", `${ws(slug)}/fields/${id}`),
  issueFields: (slug: string, issueId: string) => call<{ values: Record<string, unknown> }>("GET", `${ws(slug)}/issues/${issueId}/fields`),

  templates: (slug: string, projectId?: string) =>
    call<{ templates: IssueTemplate[] }>("GET", `${ws(slug)}/templates${projectId ? `?projectId=${projectId}` : ""}`),
  createTemplate: (slug: string, input: Record<string, unknown>) => call<{ template: IssueTemplate }>("POST", `${ws(slug)}/templates`, input),
  deleteTemplate: (slug: string, id: string) => call("DELETE", `${ws(slug)}/templates/${id}`),
  recurrences: (slug: string) => call<{ recurrences: RecurrenceRow[] }>("GET", `${ws(slug)}/recurrences`),
  createRecurrence: (slug: string, input: Record<string, unknown>) => call("POST", `${ws(slug)}/recurrences`, input),
  setRecurrenceActive: (slug: string, id: string, active: boolean) => call("PATCH", `${ws(slug)}/recurrences/${id}`, { active }),
  deleteRecurrence: (slug: string, id: string) => call("DELETE", `${ws(slug)}/recurrences/${id}`),

  automations: (slug: string) => call<{ rules: AutomationRuleRow[] }>("GET", `${ws(slug)}/automations`),
  createAutomation: (slug: string, input: Omit<AutomationRuleRow, "id" | "runCount" | "lastRunAt" | "lastError">) =>
    call<{ rule: AutomationRuleRow }>("POST", `${ws(slug)}/automations`, input),
  updateAutomation: (slug: string, id: string, patch: { active?: boolean }) => call("PATCH", `${ws(slug)}/automations/${id}`, patch),
  deleteAutomation: (slug: string, id: string) => call("DELETE", `${ws(slug)}/automations/${id}`),

  timeEntries: (slug: string, issueId: string) =>
    call<{ entries: TimeEntryRow[]; totalMinutes: number }>("GET", `${ws(slug)}/issues/${issueId}/time`),
  logTime: (slug: string, issueId: string, input: { minutes: number; date: string; note?: string }) =>
    call("POST", `${ws(slug)}/issues/${issueId}/time`, input),
  deleteTime: (slug: string, id: string) => call("DELETE", `${ws(slug)}/time/${id}`),

  report: (slug: string, q: { projectId?: string; from?: string; to?: string }) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return call<Report>("GET", `${ws(slug)}/reports${p.size ? `?${p}` : ""}`);
  },
  importPreview: (slug: string, csv: string) => call<{ headers: string[] }>("POST", `${ws(slug)}/import/preview`, { csv }),
  runImport: (slug: string, input: ImportInput) =>
    call<{ stats: { created: number; updated: number; skipped: number; labels: number } }>("POST", `${ws(slug)}/import`, input),

  agents: (slug: string) =>
    call<{ agents: { id: string; name: string; role: Role; tokenPrefix: string | null; canWrite: boolean; lastUsedAt: string | null }[] }>("GET", `${ws(slug)}/agents`),
  createAgent: (slug: string, input: { name: string; role: "member" | "guest"; write: boolean; projectIds?: string[] }) =>
    call<{ agent: { id: string; name: string }; token: string }>("POST", `${ws(slug)}/agents`, input),
  rotateAgentToken: (slug: string, id: string, write: boolean) => call<{ token: string }>("POST", `${ws(slug)}/agents/${id}/token`, { write }),
  removeAgent: (slug: string, id: string) => call("DELETE", `${ws(slug)}/agents/${id}`),
  ai: () => call<{ enabled: boolean; provider: string | null }>("GET", "/ai"),
  aiSummary: (slug: string, issueId: string) => call<{ summary: string }>("POST", `${ws(slug)}/issues/${issueId}/ai/summary`, {}),
  aiDraft: (slug: string, text: string) => call<{ draft: { title: string; description: string } }>("POST", `${ws(slug)}/ai/draft-issue`, { text }),

  views: (slug: string) => call<{ views: SavedView[] }>("GET", `${ws(slug)}/views`),
  createView: (slug: string, input: Omit<SavedView, "id" | "ownerId">) =>
    call<{ view: SavedView }>("POST", `${ws(slug)}/views`, input),
  deleteView: (slug: string, id: string) => call("DELETE", `${ws(slug)}/views/${id}`),
};
