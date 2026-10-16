import {
  CSV_PRESETS,
  IMPORT_SOURCES,
  automationRuleSchema,
  can,
  csvMappingSchema,
  customFieldSchema,
  formatDate,
  issueTemplateSchema,
  issuesFromCsv,
  issuesFromGitHub,
  nextOccurrence,
  parseCsv,
  recurrenceSchema,
  timeEntrySchema,
  updateAutomationRuleSchema,
  updateCustomFieldSchema,
  updateIssueTemplateSchema,
  type AutomationAction,
} from "@kadrix/core";
import {
  automationRule,
  customField,
  issue,
  issueFieldValue,
  issueTemplate,
  label,
  project,
  recurrence,
  timeEntry,
  user,
  workflowState,
  workspaceMember,
} from "@kadrix/db";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { type AppDeps, type Env, type Membership, parseBody, parseQuery, requireUser, seesProject, workspaceGuard } from "../context.js";
import { ApiError, forbidden, invalid, notFound } from "../errors.js";
import { createSafeFetch } from "../ssrf.js";
import { fetchGitHubIssues, importIssues, MAX_IMPORT } from "../services/import.js";
import { buildReport } from "../services/reports.js";
import { MAX_RULES_PER_WORKSPACE } from "../services/automation.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function extendRoutes(deps: AppDeps) {
  const { db, events } = deps;
  const app = new Hono<Env>();
  const guard = (a: Parameters<typeof workspaceGuard>[1]) => workspaceGuard(db, a);
  const publish = (workspaceId: string, entity: string, id?: string) => events.publish({ workspaceId, entity, id }).catch(() => {});

  async function projectIn(m: Membership, projectId: string) {
    if (!z.string().uuid().safeParse(projectId).success || !seesProject(m, projectId)) throw notFound();
    const [p] = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.workspaceId, m.workspaceId)));
    if (!p) throw notFound();
    return p;
  }
  async function issueIn(m: Membership, issueId: string) {
    if (!z.string().uuid().safeParse(issueId).success) throw notFound();
    const [row] = await db
      .select({ id: issue.id, projectId: issue.projectId })
      .from(issue)
      .where(and(eq(issue.id, issueId), eq(issue.workspaceId, m.workspaceId)));
    if (!row || !seesProject(m, row.projectId)) throw notFound();
    return row;
  }
  /** Fields that apply to a project, or to every project when none is given. */
  const fieldScope = (m: Membership, projectId?: string) =>
    and(
      eq(customField.workspaceId, m.workspaceId),
      projectId
        ? or(isNull(customField.projectId), eq(customField.projectId, projectId))
        : m.projectIds === null
          ? undefined
          : or(isNull(customField.projectId), m.projectIds.length ? inArray(customField.projectId, m.projectIds) : sql`false`),
    );

  /* --------------------------- custom fields --------------------------- */

  app.get("/workspaces/:slug/fields", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const projectId = c.req.query("projectId");
    if (projectId) await projectIn(m, projectId);
    const rows = await db.select().from(customField).where(fieldScope(m, projectId)).orderBy(asc(customField.position), asc(customField.createdAt));
    return c.json({ fields: rows });
  });

  app.post("/workspaces/:slug/fields", guard("field.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, customFieldSchema);
    if (input.projectId) await projectIn(m, input.projectId);
    const choice = input.kind === "select" || input.kind === "multiSelect";
    if (choice && input.options.length === 0) throw invalid();
    if (new Set(input.options.map((o) => o.id)).size !== input.options.length) throw invalid();
    const [row] = await db
      .insert(customField)
      .values({ ...input, options: choice ? input.options : [], workspaceId: m.workspaceId, position: Date.now() })
      .returning();
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "field.created", targetType: "field", targetId: row!.id, data: { targetName: row!.name } });
    await publish(m.workspaceId, "field");
    return c.json({ field: row }, 201);
  });

  app.patch("/workspaces/:slug/fields/:fieldId", guard("field.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, updateCustomFieldSchema);
    if (input.options && new Set(input.options.map((o) => o.id)).size !== input.options.length) throw invalid();
    const [row] = await db
      .update(customField)
      .set(input)
      .where(and(eq(customField.id, c.req.param("fieldId")), eq(customField.workspaceId, m.workspaceId)))
      .returning();
    if (!row) throw notFound();
    await publish(m.workspaceId, "field");
    return c.json({ field: row });
  });

  app.delete("/workspaces/:slug/fields/:fieldId", guard("field.manage"), async (c) => {
    const m = c.get("membership");
    const [row] = await db
      .delete(customField)
      .where(and(eq(customField.id, c.req.param("fieldId")), eq(customField.workspaceId, m.workspaceId)))
      .returning();
    if (!row) throw notFound();
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "field.deleted", targetType: "field", targetId: row.id, data: { targetName: row.name } });
    await publish(m.workspaceId, "field");
    return c.json({ ok: true });
  });

  app.get("/workspaces/:slug/issues/:id/fields", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const found = await issueIn(m, c.req.param("id"));
    const rows = await db
      .select({ fieldId: issueFieldValue.fieldId, value: issueFieldValue.value })
      .from(issueFieldValue)
      .where(eq(issueFieldValue.issueId, found.id));
    return c.json({ values: Object.fromEntries(rows.map((r) => [r.fieldId, r.value])) });
  });

  /* ----------------------------- templates ---------------------------- */

  app.get("/workspaces/:slug/templates", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const projectId = c.req.query("projectId");
    if (projectId) await projectIn(m, projectId);
    const rows = await db
      .select()
      .from(issueTemplate)
      .where(
        and(
          eq(issueTemplate.workspaceId, m.workspaceId),
          projectId ? eq(issueTemplate.projectId, projectId) : undefined,
          m.projectIds === null ? undefined : m.projectIds.length ? inArray(issueTemplate.projectId, m.projectIds) : sql`false`,
        ),
      )
      .orderBy(asc(issueTemplate.name));
    return c.json({ templates: rows });
  });

  const templateValues = (input: Partial<z.infer<typeof issueTemplateSchema>>) => {
    const { name, title, description, projectId: _p, ...defaults } = input;
    return { name, title, description, defaults };
  };

  app.post("/workspaces/:slug/templates", guard("template.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, issueTemplateSchema);
    await projectIn(m, input.projectId);
    const v = templateValues(input);
    const [row] = await db
      .insert(issueTemplate)
      .values({ workspaceId: m.workspaceId, projectId: input.projectId, name: v.name!, title: v.title ?? "", description: v.description ?? "", defaults: v.defaults, createdBy: requireUser(c).id })
      .returning();
    await publish(m.workspaceId, "template");
    return c.json({ template: row }, 201);
  });

  async function templateIn(m: Membership, id: string) {
    if (!z.string().uuid().safeParse(id).success) throw notFound();
    const [row] = await db
      .select()
      .from(issueTemplate)
      .where(and(eq(issueTemplate.id, id), eq(issueTemplate.workspaceId, m.workspaceId)));
    if (!row || !seesProject(m, row.projectId)) throw notFound();
    return row;
  }

  app.patch("/workspaces/:slug/templates/:templateId", guard("template.manage"), async (c) => {
    const m = c.get("membership");
    const cur = await templateIn(m, c.req.param("templateId"));
    const input = await parseBody(c, updateIssueTemplateSchema);
    const v = templateValues(input);
    const [row] = await db
      .update(issueTemplate)
      .set({
        ...(v.name !== undefined ? { name: v.name } : {}),
        ...(v.title !== undefined ? { title: v.title } : {}),
        ...(v.description !== undefined ? { description: v.description } : {}),
        defaults: { ...cur.defaults, ...v.defaults },
      })
      .where(eq(issueTemplate.id, cur.id))
      .returning();
    await publish(m.workspaceId, "template");
    return c.json({ template: row });
  });

  app.delete("/workspaces/:slug/templates/:templateId", guard("template.manage"), async (c) => {
    const m = c.get("membership");
    const cur = await templateIn(m, c.req.param("templateId"));
    await db.delete(issueTemplate).where(eq(issueTemplate.id, cur.id));
    await publish(m.workspaceId, "template");
    return c.json({ ok: true });
  });

  /* ---------------------------- recurrence ---------------------------- */

  app.get("/workspaces/:slug/recurrences", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({ recurrence, templateName: issueTemplate.name, projectId: issueTemplate.projectId })
      .from(recurrence)
      .innerJoin(issueTemplate, eq(issueTemplate.id, recurrence.templateId))
      .where(eq(recurrence.workspaceId, m.workspaceId))
      .orderBy(asc(recurrence.nextDate));
    return c.json({
      recurrences: rows.filter((r) => seesProject(m, r.projectId)).map((r) => ({ ...r.recurrence, templateName: r.templateName, projectId: r.projectId })),
    });
  });

  app.post("/workspaces/:slug/recurrences", guard("template.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, recurrenceSchema);
    await templateIn(m, input.templateId);
    const today = formatDate(new Date());
    // Never back-fill: the first issue is due on or after today.
    let next = nextOccurrence(input, null);
    if (next < today) next = nextOccurrence({ ...input }, formatDate(new Date(Date.now() - 864e5)));
    const [row] = await db
      .insert(recurrence)
      .values({ ...input, workspaceId: m.workspaceId, nextDate: next, createdBy: requireUser(c).id })
      .returning();
    await publish(m.workspaceId, "recurrence");
    return c.json({ recurrence: row }, 201);
  });

  async function recurrenceIn(m: Membership, id: string) {
    if (!z.string().uuid().safeParse(id).success) throw notFound();
    const [row] = await db
      .select({ id: recurrence.id, templateId: recurrence.templateId })
      .from(recurrence)
      .where(and(eq(recurrence.id, id), eq(recurrence.workspaceId, m.workspaceId)));
    if (!row) throw notFound();
    await templateIn(m, row.templateId);
    return row;
  }

  app.patch("/workspaces/:slug/recurrences/:id", guard("template.manage"), async (c) => {
    const m = c.get("membership");
    const cur = await recurrenceIn(m, c.req.param("id"));
    const { active } = await parseBody(c, z.object({ active: z.boolean() }));
    const [row] = await db.update(recurrence).set({ active }).where(eq(recurrence.id, cur.id)).returning();
    await publish(m.workspaceId, "recurrence");
    return c.json({ recurrence: row });
  });

  app.delete("/workspaces/:slug/recurrences/:id", guard("template.manage"), async (c) => {
    const m = c.get("membership");
    const cur = await recurrenceIn(m, c.req.param("id"));
    await db.delete(recurrence).where(eq(recurrence.id, cur.id));
    await publish(m.workspaceId, "recurrence");
    return c.json({ ok: true });
  });

  /* ---------------------------- automation ---------------------------- */

  /** Every id a rule points at must exist in this workspace (and project). */
  async function checkActions(m: Membership, projectId: string | null, actions: AutomationAction[]) {
    for (const a of actions) {
      if (a.kind === "setState") {
        // States belong to a project, so a workspace-wide rule cannot set one.
        if (!projectId) throw invalid();
        const [s] = await db.select({ id: workflowState.id }).from(workflowState).where(and(eq(workflowState.id, a.stateId), eq(workflowState.projectId, projectId)));
        if (!s) throw invalid();
      }
      if (a.kind === "addLabel" || a.kind === "removeLabel") {
        const [l] = await db.select({ id: label.id }).from(label).where(and(eq(label.id, a.labelId), eq(label.workspaceId, m.workspaceId)));
        if (!l) throw invalid();
      }
      if (a.kind === "assign" && a.userId) {
        const [u] = await db
          .select({ id: workspaceMember.userId })
          .from(workspaceMember)
          .where(and(eq(workspaceMember.workspaceId, m.workspaceId), eq(workspaceMember.userId, a.userId)));
        if (!u) throw invalid();
      }
      if (a.kind === "setField") {
        const [f] = await db.select({ id: customField.id }).from(customField).where(and(eq(customField.id, a.fieldId), fieldScope(m, projectId ?? undefined)));
        if (!f) throw invalid();
      }
    }
  }

  app.get("/workspaces/:slug/automations", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    if (m.projectIds !== null) return c.json({ rules: [] });
    const rows = await db.select().from(automationRule).where(eq(automationRule.workspaceId, m.workspaceId)).orderBy(asc(automationRule.createdAt));
    return c.json({ rules: rows });
  });

  app.post("/workspaces/:slug/automations", guard("automation.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, automationRuleSchema);
    if (input.projectId) await projectIn(m, input.projectId);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(automationRule).where(eq(automationRule.workspaceId, m.workspaceId));
    if ((count?.n ?? 0) >= MAX_RULES_PER_WORKSPACE) throw new ApiError(409, "limitReached");
    await checkActions(m, input.projectId, input.actions);
    const [row] = await db
      .insert(automationRule)
      .values({ ...input, workspaceId: m.workspaceId, createdBy: requireUser(c).id })
      .returning();
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "automation.created", targetType: "automation", targetId: row!.id, data: { targetName: row!.name } });
    await publish(m.workspaceId, "automation");
    return c.json({ rule: row }, 201);
  });

  app.patch("/workspaces/:slug/automations/:id", guard("automation.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, updateAutomationRuleSchema);
    const [cur] = await db
      .select()
      .from(automationRule)
      .where(and(eq(automationRule.id, c.req.param("id")), eq(automationRule.workspaceId, m.workspaceId)));
    if (!cur) throw notFound();
    if (input.actions) await checkActions(m, cur.projectId, input.actions);
    const [row] = await db.update(automationRule).set(input).where(eq(automationRule.id, cur.id)).returning();
    await publish(m.workspaceId, "automation");
    return c.json({ rule: row });
  });

  app.delete("/workspaces/:slug/automations/:id", guard("automation.manage"), async (c) => {
    const m = c.get("membership");
    const [row] = await db
      .delete(automationRule)
      .where(and(eq(automationRule.id, c.req.param("id")), eq(automationRule.workspaceId, m.workspaceId)))
      .returning();
    if (!row) throw notFound();
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "automation.deleted", targetType: "automation", targetId: row.id, data: { targetName: row.name } });
    await publish(m.workspaceId, "automation");
    return c.json({ ok: true });
  });

  /* --------------------------- time tracking -------------------------- */

  app.get("/workspaces/:slug/issues/:id/time", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const found = await issueIn(m, c.req.param("id"));
    const rows = await db
      .select({ id: timeEntry.id, minutes: timeEntry.minutes, date: timeEntry.date, note: timeEntry.note, userId: timeEntry.userId, userName: user.name, createdAt: timeEntry.createdAt })
      .from(timeEntry)
      .leftJoin(user, eq(user.id, timeEntry.userId))
      .where(eq(timeEntry.issueId, found.id))
      .orderBy(desc(timeEntry.date), desc(timeEntry.createdAt));
    return c.json({ entries: rows, totalMinutes: rows.reduce((s, r) => s + r.minutes, 0) });
  });

  app.post("/workspaces/:slug/issues/:id/time", guard("time.log"), async (c) => {
    const m = c.get("membership");
    const found = await issueIn(m, c.req.param("id"));
    const input = await parseBody(c, timeEntrySchema);
    const [row] = await db
      .insert(timeEntry)
      .values({ ...input, workspaceId: m.workspaceId, issueId: found.id, userId: requireUser(c).id })
      .returning();
    await publish(m.workspaceId, "issue", found.id);
    return c.json({ entry: row }, 201);
  });

  app.delete("/workspaces/:slug/time/:entryId", guard("time.log"), async (c) => {
    const m = c.get("membership");
    const id = c.req.param("entryId");
    if (!z.string().uuid().safeParse(id).success) throw notFound();
    const [row] = await db
      .select()
      .from(timeEntry)
      .where(and(eq(timeEntry.id, id), eq(timeEntry.workspaceId, m.workspaceId)));
    if (!row) throw notFound();
    // People remove their own entries; admins can remove anyone's.
    if (row.userId !== requireUser(c).id && !can(m.role, "issue.delete")) throw forbidden();
    await db.delete(timeEntry).where(eq(timeEntry.id, row.id));
    await publish(m.workspaceId, "issue", row.issueId);
    return c.json({ ok: true });
  });

  /* ------------------------------ reports ----------------------------- */

  app.get("/workspaces/:slug/reports", guard("report.read"), async (c) => {
    const m = c.get("membership");
    const q = parseQuery(
      { projectId: c.req.query("projectId") || undefined, from: c.req.query("from"), to: c.req.query("to") },
      z.object({ projectId: z.string().uuid().optional(), from: isoDate.optional(), to: isoDate.optional() }),
    );
    if (q.projectId) await projectIn(m, q.projectId);
    const to = q.to ?? formatDate(new Date());
    const from = q.from ?? formatDate(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 864e5));
    if (from > to || Date.parse(to) - Date.parse(from) > 366 * 864e5) throw invalid();
    return c.json(await buildReport(db, m, { projectId: q.projectId, from, to }));
  });

  /* ------------------------------ import ------------------------------ */

  const importSchema = z.discriminatedUnion("source", [
    z.object({ source: z.literal("csv"), projectId: z.string().uuid(), csv: z.string().max(10_000_000), mapping: csvMappingSchema }),
    z.object({ source: z.enum(["jira", "linear"]), projectId: z.string().uuid(), csv: z.string().max(10_000_000) }),
    z.object({
      source: z.literal("github"),
      projectId: z.string().uuid(),
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      token: z.string().max(200).optional(),
    }),
  ]);

  app.post("/workspaces/:slug/import", guard("import.run"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, importSchema);
    const proj = await projectIn(m, input.projectId);
    let items;
    if (input.source === "github") {
      const raw = await fetchGitHubIssues(deps.importFetch ?? createSafeFetch(false), input.repo, input.token).catch(() => {
        throw new ApiError(502, "importFailed");
      });
      items = issuesFromGitHub(raw as Parameters<typeof issuesFromGitHub>[0]);
    } else {
      items = issuesFromCsv(input.csv, input.source === "csv" ? input.mapping : CSV_PRESETS[input.source]);
    }
    if (!items.length) throw invalid();
    if (items.length > MAX_IMPORT) throw new ApiError(413, "tooLarge");
    const stats = await importIssues(deps, { workspaceId: m.workspaceId, projectId: input.projectId, actorId: requireUser(c).id, source: input.source, items });
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "import.completed", targetType: "project", targetId: input.projectId, data: { source: input.source, targetName: proj.name, ...stats } });
    await publish(m.workspaceId, "issue");
    return c.json({ stats });
  });

  /** Header row of a CSV, to build a column mapping in the UI. */
  app.post("/workspaces/:slug/import/preview", guard("import.run"), async (c) => {
    const { csv } = await parseBody(c, z.object({ csv: z.string().max(10_000_000) }));
    const firstLine = csv.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
    return c.json({ headers: parseCsv(firstLine)[0] ?? [], sources: IMPORT_SOURCES });
  });

  return app;
}
