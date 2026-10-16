import {
  addMemberSchema,
  commentSchema,
  createCycleSchema,
  createIssueSchema,
  createProjectSchema,
  createTokenSchema,
  createWebhookSchema,
  createWorkspaceSchema,
  initiativeSchema,
  issueFilterSchema,
  labelSchema,
  milestoneSchema,
  relationSchema,
  releaseSchema,
  statusUpdateSchema,
  updateIssueSchema,
} from "@kadrix/core";
import { z } from "zod";

type Op = {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  summary: string;
  tag: string;
  body?: z.ZodType;
  query?: Record<string, string>;
};

const ws = "/workspaces/{slug}";

/** Public REST surface. Request bodies are generated from the same Zod schemas the server validates with. */
const OPS: Op[] = [
  { method: "get", path: "/me", summary: "The authenticated user", tag: "Account" },
  { method: "get", path: "/workspaces", summary: "Workspaces you belong to", tag: "Workspaces" },
  { method: "post", path: "/workspaces", summary: "Create a workspace (session only)", tag: "Workspaces", body: createWorkspaceSchema },
  { method: "get", path: ws, summary: "Workspace details and your role", tag: "Workspaces" },
  { method: "get", path: `${ws}/members`, summary: "List members", tag: "Members" },
  { method: "post", path: `${ws}/members`, summary: "Add an existing user as a member", tag: "Members", body: addMemberSchema },
  { method: "get", path: `${ws}/projects`, summary: "List projects", tag: "Projects" },
  { method: "post", path: `${ws}/projects`, summary: "Create a project with default workflow", tag: "Projects", body: createProjectSchema },
  { method: "get", path: `${ws}/projects/{projectId}`, summary: "Project with its workflow states", tag: "Projects" },
  { method: "get", path: `${ws}/labels`, summary: "List labels", tag: "Labels" },
  { method: "post", path: `${ws}/labels`, summary: "Create a label", tag: "Labels", body: labelSchema },
  {
    method: "get",
    path: `${ws}/issues`,
    summary: "List issues. `filter` is URL-encoded JSON matching IssueFilter.",
    tag: "Issues",
    query: { filter: "JSON IssueFilter", limit: "max 1000", offset: "number" },
  },
  { method: "post", path: `${ws}/issues`, summary: "Create an issue", tag: "Issues", body: createIssueSchema },
  { method: "get", path: `${ws}/issues/key/{key}`, summary: "Find an issue by key, e.g. VEL-42", tag: "Issues" },
  { method: "get", path: `${ws}/issues/{id}`, summary: "Issue with sub-issues and relations", tag: "Issues" },
  { method: "patch", path: `${ws}/issues/{id}`, summary: "Update an issue", tag: "Issues", body: updateIssueSchema },
  { method: "delete", path: `${ws}/issues/{id}`, summary: "Delete an issue (admins)", tag: "Issues" },
  { method: "get", path: `${ws}/issues/{id}/activity`, summary: "Change history", tag: "Issues" },
  { method: "get", path: `${ws}/issues/{id}/comments`, summary: "List comments", tag: "Comments" },
  { method: "post", path: `${ws}/issues/{id}/comments`, summary: "Add a comment. Mention with <@userId>.", tag: "Comments", body: commentSchema },
  { method: "post", path: `${ws}/issues/{id}/relations`, summary: "Relate two issues", tag: "Issues", body: relationSchema },
  { method: "get", path: `${ws}/issues/{id}/links`, summary: "Linked pull requests and commits", tag: "Git" },
  { method: "get", path: `${ws}/projects/{projectId}/cycles`, summary: "Cycles with progress and velocity", tag: "Planning" },
  { method: "post", path: `${ws}/projects/{projectId}/cycles`, summary: "Create a cycle", tag: "Planning", body: createCycleSchema },
  { method: "post", path: `${ws}/cycles/{id}/complete`, summary: "Complete a cycle and roll over open work", tag: "Planning" },
  { method: "get", path: `${ws}/cycles/{id}/burndown`, summary: "Burndown series", tag: "Planning" },
  { method: "get", path: `${ws}/projects/{projectId}/milestones`, summary: "Milestones with progress", tag: "Planning" },
  { method: "post", path: `${ws}/projects/{projectId}/milestones`, summary: "Create a milestone", tag: "Planning", body: milestoneSchema },
  { method: "get", path: `${ws}/projects/{projectId}/timeline`, summary: "Dated issues, dependencies and critical path", tag: "Planning" },
  { method: "get", path: `${ws}/initiatives`, summary: "Initiatives with rolled-up progress", tag: "Planning" },
  { method: "post", path: `${ws}/initiatives`, summary: "Create an initiative", tag: "Planning", body: initiativeSchema },
  { method: "post", path: `${ws}/updates`, summary: "Post a health update", tag: "Planning", body: statusUpdateSchema },
  { method: "get", path: `${ws}/projects/{projectId}/releases`, summary: "Releases", tag: "Releases" },
  { method: "post", path: `${ws}/projects/{projectId}/releases`, summary: "Create a release", tag: "Releases", body: releaseSchema },
  { method: "post", path: `${ws}/releases/{id}/publish`, summary: "Publish a release", tag: "Releases" },
  { method: "get", path: `${ws}/tokens`, summary: "Your API tokens", tag: "Access" },
  { method: "post", path: `${ws}/tokens`, summary: "Create an API token (shown once)", tag: "Access", body: createTokenSchema },
  { method: "get", path: `${ws}/webhooks`, summary: "Webhooks", tag: "Webhooks" },
  { method: "post", path: `${ws}/webhooks`, summary: "Create a webhook (secret shown once)", tag: "Webhooks", body: createWebhookSchema },
];

export function openApiDocument(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const query = Object.entries(op.query ?? {}).map(([name, description]) => ({ name, in: "query", description, schema: { type: "string" } }));
    (paths[op.path] ??= {})[op.method] = {
      summary: op.summary,
      tags: [op.tag],
      parameters: [...params, ...query],
      ...(op.body
        ? { requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(op.body, { io: "input" }) } } } }
        : {}),
      responses: {
        "200": { description: "OK" },
        "4XX": { description: "Error with body { error: code }", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Kadrix API",
      version: "1",
      description:
        "Authenticate with `Authorization: Bearer kdx_…` (create a token in workspace settings). Tokens are limited to one workspace; read-only tokens can only GET. Errors return `{ error: code }`.",
    },
    servers: [{ url: `${baseUrl}/api` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
        IssueFilter: z.toJSONSchema(issueFilterSchema, { io: "input" }),
      },
    },
    paths,
  };
}
