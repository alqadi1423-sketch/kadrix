import { AUTOMATION_TRIGGERS, FIELD_KINDS, IMPORT_SOURCES, ISSUE_TYPES, RECURRENCE_FREQ, RELATION_TYPES, ROLES, STATE_CATEGORIES, VIEW_LAYOUTS } from "@veloq/core";
import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------------ */
/* Authentication tables (shape required by Better Auth)              */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** "agent" for AI coding agents and bots: no password, act only through API tokens. */
  kind: text("kind").notNull().default("human"),
  /** Agents belong to one workspace and are removed with it. */
  agentWorkspaceId: uuid("agent_workspace_id").references((): AnyPgColumn => workspace.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Tenancy. Every tenant-owned row carries workspace_id.              */
/* ------------------------------------------------------------------ */

export const roleEnum = pgEnum("workspace_role", ROLES);

export const workspace = pgTable("workspace", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Days of week (0 = Sunday) that are not working days. */
  weekendDays: integer("weekend_days").array().notNull().default(sql`'{5,6}'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMember = pgTable(
  "workspace_member",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("member_user_idx").on(t.userId)],
);

/**
 * Append-only. A database trigger (see migrations) rejects UPDATE and DELETE,
 * so the log cannot be altered even by application bugs.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_workspace_created_idx").on(t.workspaceId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Work model                                                         */
/* ------------------------------------------------------------------ */

export const stateCategoryEnum = pgEnum("state_category", STATE_CATEGORIES);
export const issueTypeEnum = pgEnum("issue_type", ISSUE_TYPES);
export const relationTypeEnum = pgEnum("relation_type", RELATION_TYPES);
export const viewLayoutEnum = pgEnum("view_layout", VIEW_LAYOUTS);

const wsRef = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" });

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Last issue number handed out; bumped atomically on issue creation. */
    issueCounter: integer("issue_counter").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("project_ws_key_uq").on(t.workspaceId, t.key)],
);

export const workflowState = pgTable(
  "workflow_state",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: stateCategoryEnum("category").notNull(),
    color: text("color").notNull(),
    position: doublePrecision("position").notNull(),
    /** Kanban work-in-progress limit; the board warns when exceeded. */
    wipLimit: integer("wip_limit"),
    createdAt: createdAt(),
  },
  (t) => [index("state_project_idx").on(t.projectId, t.position)],
);

export const label = pgTable(
  "label",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("label_ws_name_uq").on(t.workspaceId, t.name)],
);

export const cycle = pgTable(
  "cycle",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    name: text("name"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    /** Set when the cycle is closed and unfinished work rolled over. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("cycle_project_number_uq").on(t.projectId, t.number)],
);

export const milestone = pgTable(
  "milestone",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    targetDate: date("target_date"),
    createdAt: createdAt(),
  },
  (t) => [index("milestone_project_idx").on(t.projectId)],
);

export const issue = pgTable(
  "issue",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    type: issueTypeEnum("type").notNull().default("task"),
    title: text("title").notNull(),
    description: text("description"),
    stateId: uuid("state_id")
      .notNull()
      .references(() => workflowState.id),
    priority: smallint("priority").notNull().default(0),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => issue.id, { onDelete: "set null" }),
    cycleId: uuid("cycle_id").references(() => cycle.id, { onDelete: "set null" }),
    milestoneId: uuid("milestone_id").references(() => milestone.id, { onDelete: "set null" }),
    estimate: real("estimate"),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    /** 'simple' config: language-neutral, works for Arabic and English text. */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', veloq_search_text(coalesce(${issue.title}, ''))), 'A') || setweight(to_tsvector('simple', veloq_search_text(coalesce(${issue.description}, ''))), 'B')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("issue_project_number_uq").on(t.projectId, t.number),
    index("issue_ws_state_idx").on(t.workspaceId, t.stateId),
    index("issue_assignee_idx").on(t.workspaceId, t.assigneeId),
    index("issue_parent_idx").on(t.parentId),
    index("issue_cycle_idx").on(t.cycleId),
    index("issue_search_idx").using("gin", t.searchVector),
    index("issue_title_trgm_idx").using("gin", sql`veloq_search_text(${t.title}) gin_trgm_ops`),
  ],
);

export const issueLabel = pgTable(
  "issue_label",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })],
);

export const issueRelation = pgTable(
  "issue_relation",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    type: relationTypeEnum("type").notNull(),
    /** For "blocks": issueId blocks relatedIssueId. */
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    relatedIssueId: uuid("related_issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("relation_uq").on(t.issueId, t.relatedIssueId, t.type)],
);

/**
 * Every state change with its time. Cycle time, lead time, burndown and
 * cumulative flow are computed from this table, so it must be written on
 * every state change, including the initial state at creation.
 */
export const issueTransition = pgTable(
  "issue_transition",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    fromStateId: uuid("from_state_id").references(() => workflowState.id, { onDelete: "set null" }),
    toStateId: uuid("to_state_id")
      .notNull()
      .references(() => workflowState.id, { onDelete: "cascade" }),
    fromCategory: stateCategoryEnum("from_category"),
    toCategory: stateCategoryEnum("to_category").notNull(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transition_issue_idx").on(t.issueId, t.at), index("transition_ws_at_idx").on(t.workspaceId, t.at)],
);

/** Field-level history shown in the issue activity feed. */
export const issueActivity = pgTable(
  "issue_activity",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    /** Set when a change came from an integration rather than a person (e.g. "github"). */
    source: text("source"),
    field: text("field").notNull(),
    fromValue: jsonb("from_value"),
    toValue: jsonb("to_value"),
    createdAt: createdAt(),
  },
  (t) => [index("activity_issue_idx").on(t.issueId, t.createdAt)],
);

export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    /** Set when no person wrote it (e.g. "automation"). */
    source: text("source"),
    body: text("body").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("comment_issue_idx").on(t.issueId, t.createdAt)],
);

export const attachment = pgTable(
  "attachment",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    issueId: uuid("issue_id").references(() => issue.id, { onDelete: "cascade" }),
    uploaderId: text("uploader_id").references(() => user.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("attachment_issue_idx").on(t.issueId)],
);

export const issueSubscriber = pgTable(
  "issue_subscriber",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.userId] })],
);

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issue.id, { onDelete: "cascade" }),
    /** assigned | mentioned | commented | stateChanged */
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt)],
);

export const savedView = pgTable(
  "saved_view",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    layout: viewLayoutEnum("layout").notNull(),
    filter: jsonb("filter").$type<Record<string, unknown>>().notNull(),
    shared: boolean("shared").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("view_ws_idx").on(t.workspaceId)],
);

/* ------------------------------------------------------------------ */
/* Initiatives: a layer above projects with status updates            */
/* ------------------------------------------------------------------ */

export const healthEnum = pgEnum("health", ["onTrack", "atRisk", "offTrack"]);

export const initiative = pgTable(
  "initiative",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    name: text("name").notNull(),
    description: text("description"),
    targetDate: date("target_date"),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("initiative_ws_idx").on(t.workspaceId)],
);

export const initiativeProject = pgTable(
  "initiative_project",
  {
    initiativeId: uuid("initiative_id")
      .notNull()
      .references(() => initiative.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.initiativeId, t.projectId] })],
);

/** Health updates posted on an initiative or a project. */
export const statusUpdate = pgTable(
  "status_update",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    initiativeId: uuid("initiative_id").references(() => initiative.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    health: healthEnum("health").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("status_initiative_idx").on(t.initiativeId, t.createdAt), index("status_project_idx").on(t.projectId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Developer integration: tokens, webhooks, Git links, releases       */
/* ------------------------------------------------------------------ */

/** Personal API tokens, bound to one user in one workspace. Only a hash is stored. */
export const apiToken = pgTable(
  "api_token",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** First characters, shown so people can tell tokens apart. */
    prefix: text("prefix").notNull(),
    scopes: text("scopes").array().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("token_user_idx").on(t.userId)],
);

export const webhook = pgTable(
  "webhook",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").array().notNull(),
    /** Payload shape: "veloq" (JSON), "slack" or "discord" (chat message). */
    format: text("format").notNull().default("veloq"),
    /** Language for chat messages (Slack/Discord). */
    locale: text("locale").notNull().default("en"),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_ws_idx").on(t.workspaceId)],
);

/** Outgoing deliveries: a PostgreSQL-backed queue with retries. */
export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** pending | success | failed */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("delivery_due_idx").on(t.status, t.nextAttemptAt), index("delivery_hook_idx").on(t.webhookId, t.createdAt)],
);

/** Incoming Git provider connection (GitHub or GitLab webhooks). */
export const integration = pgTable(
  "integration",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    secret: text("secret").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("integration_ws_idx").on(t.workspaceId)],
);

export const issueLink = pgTable(
  "issue_link",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** pull_request | commit | branch */
    kind: text("kind").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    /** draft | open | merged | closed (pull requests) */
    state: text("state"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("issue_link_uq").on(t.issueId, t.provider, t.kind, t.externalId), index("issue_link_issue_idx").on(t.issueId)],
);

export const release = pgTable(
  "release",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    name: text("name"),
    notes: text("notes"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("release_project_version_uq").on(t.projectId, t.version)],
);

export const releaseIssue = pgTable(
  "release_issue",
  {
    releaseId: uuid("release_id")
      .notNull()
      .references(() => release.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.releaseId, t.issueId] })],
);

/* ------------------------------------------------------------------ */
/* Docs and collaboration                                             */
/* ------------------------------------------------------------------ */

/**
 * A document page. The body is a Yjs document (binary CRDT state) edited
 * live by several people; `contentText` is a plain-text copy for search.
 */
export const page = pgTable(
  "page",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => page.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ydoc: bytea("ydoc"),
    contentText: text("content_text").notNull().default(""),
    position: doublePrecision("position").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', veloq_search_text(coalesce(${page.title}, ''))), 'A') || setweight(to_tsvector('simple', veloq_search_text(coalesce(${page.contentText}, ''))), 'B')`,
    ),
  },
  (t) => [index("page_ws_idx").on(t.workspaceId, t.projectId), index("page_search_idx").using("gin", t.searchVector)],
);

/** Issues mentioned (by key) inside a page; rebuilt whenever the page is saved. */
export const pageIssue = pgTable(
  "page_issue",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.issueId] }), index("page_issue_issue_idx").on(t.issueId)],
);

/** Projects a guest may see. Guests without rows here see no projects. */
export const projectAccess = pgTable(
  "project_access",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("project_access_user_idx").on(t.userId)],
);

export const userPreference = pgTable("user_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  locale: text("locale").notNull().default("en"),
  emailDigest: boolean("email_digest").notNull().default(true),
  lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
});

/* ------------------------------------------------------------------ */
/* Phase 5: fields, templates, recurrence, automation, time, import   */
/* ------------------------------------------------------------------ */

export const fieldKindEnum = pgEnum("field_kind", FIELD_KINDS);

export const customField = pgTable(
  "custom_field",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    /** Null: the field applies to every project. */
    projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: fieldKindEnum("kind").notNull(),
    options: jsonb("options").$type<{ id: string; name: string; color?: string }[]>().notNull().default([]),
    position: doublePrecision("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("custom_field_ws_idx").on(t.workspaceId, t.projectId)],
);

export const issueFieldValue = pgTable(
  "issue_field_value",
  {
    workspaceId: wsRef(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => customField.id, { onDelete: "cascade" }),
    value: jsonb("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.fieldId] }), index("field_value_field_idx").on(t.fieldId)],
);

export const issueTemplate = pgTable(
  "issue_template",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    defaults: jsonb("defaults")
      .$type<{ type?: string; priority?: number; estimate?: number | null; assigneeId?: string | null; labelIds?: string[]; fields?: Record<string, unknown> }>()
      .notNull()
      .default({}),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("issue_template_project_idx").on(t.projectId)],
);

export const recurrenceFreqEnum = pgEnum("recurrence_freq", RECURRENCE_FREQ);

export const recurrence = pgTable(
  "recurrence",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => issueTemplate.id, { onDelete: "cascade" }),
    freq: recurrenceFreqEnum("freq").notNull(),
    interval: smallint("interval").notNull().default(1),
    weekdays: smallint("weekdays").array().notNull().default(sql`'{}'`),
    dayOfMonth: smallint("day_of_month"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    /** The next date an issue is due to be created. */
    nextDate: date("next_date", { mode: "string" }).notNull(),
    lastDate: date("last_date", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("recurrence_due_idx").on(t.active, t.nextDate)],
);

export const automationTriggerEnum = pgEnum("automation_trigger", AUTOMATION_TRIGGERS);

export const automationRule = pgTable(
  "automation_rule",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trigger: automationTriggerEnum("trigger").notNull(),
    conditions: jsonb("conditions").$type<unknown[]>().notNull().default([]),
    actions: jsonb("actions").$type<unknown[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("automation_rule_ws_idx").on(t.workspaceId, t.trigger)],
);

export const timeEntry = pgTable(
  "time_entry",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: wsRef(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    minutes: integer("minutes").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("time_entry_issue_idx").on(t.issueId), index("time_entry_ws_date_idx").on(t.workspaceId, t.date)],
);

export const importSourceEnum = pgEnum("import_source", IMPORT_SOURCES);

export const importJob = pgTable("import_job", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: wsRef(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  source: importSourceEnum("source").notNull(),
  stats: jsonb("stats").$type<{ created: number; updated: number; skipped: number; labels: number }>().notNull(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/** Where an imported issue came from, so importing again updates instead of duplicating. */
export const importRef = pgTable(
  "import_ref",
  {
    workspaceId: wsRef(),
    source: importSourceEnum("source").notNull(),
    externalId: text("external_id").notNull(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.source, t.externalId] }), index("import_ref_issue_idx").on(t.issueId)],
);
