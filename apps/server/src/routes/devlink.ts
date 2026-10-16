import {
  DEFAULT_PR_MAPPING,
  branchName,
  createIntegrationSchema,
  createTokenSchema,
  createWebhookSchema,
  findIssueKeys,
  keysFromBranch,
  prMappingSchema,
  releaseSchema,
  type PrEvent,
} from "@veloq/core";
import {
  apiToken,
  integration,
  issue,
  issueLink,
  project,
  release,
  releaseIssue,
  webhook,
  webhookDelivery,
  workflowState,
  type Database,
} from "@veloq/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { type AppDeps, type Env, parseBody, requireUser, workspaceGuard } from "../context.js";
import { generateToken, hmacSha256, randomSecret, safeEqual } from "../crypto.js";
import { ApiError, invalid, notFound, unauthorized } from "../errors.js";
import { updateIssue } from "../services/issues.js";
import { getIssue, listIssues } from "../services/query.js";
import { enqueueWebhooks, processDeliveries } from "../services/webhooks.js";
import { UnsafeUrlError, assertSafeUrl } from "../ssrf.js";

export function devlinkRoutes(deps: AppDeps) {
  const { db, events, sealer, baseUrl } = deps;
  const app = new Hono<Env>();
  const guard = (a: Parameters<typeof workspaceGuard>[1]) => workspaceGuard(db, a);

  /* ------------------------------ tokens ------------------------------ */

  app.get("/workspaces/:slug/tokens", guard("token.manage"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({
        id: apiToken.id,
        name: apiToken.name,
        prefix: apiToken.prefix,
        scopes: apiToken.scopes,
        lastUsedAt: apiToken.lastUsedAt,
        expiresAt: apiToken.expiresAt,
        createdAt: apiToken.createdAt,
      })
      .from(apiToken)
      .where(and(eq(apiToken.workspaceId, m.workspaceId), eq(apiToken.userId, requireUser(c).id), isNull(apiToken.revokedAt)))
      .orderBy(desc(apiToken.createdAt));
    return c.json({ tokens: rows });
  });

  /** The plain token is returned once, here, and never again. */
  app.post("/workspaces/:slug/tokens", guard("token.manage"), async (c) => {
    if (c.get("tokenWorkspaceId")) throw new ApiError(403, "forbidden");
    const m = c.get("membership");
    const u = requireUser(c);
    const input = await parseBody(c, createTokenSchema);
    const { token, hash, prefix } = generateToken();
    const [row] = await db
      .insert(apiToken)
      .values({
        workspaceId: m.workspaceId,
        userId: u.id,
        name: input.name,
        tokenHash: hash,
        prefix,
        scopes: [...new Set(input.scopes)],
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 864e5) : null,
      })
      .returning({ id: apiToken.id, name: apiToken.name, prefix: apiToken.prefix, scopes: apiToken.scopes });
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: u.id, action: "token.created", data: { name: input.name } });
    return c.json({ token: { ...row, value: token } }, 201);
  });

  app.delete("/workspaces/:slug/tokens/:id", guard("token.manage"), async (c) => {
    const m = c.get("membership");
    const u = requireUser(c);
    const [row] = await db
      .update(apiToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiToken.id, c.req.param("id")), eq(apiToken.workspaceId, m.workspaceId), eq(apiToken.userId, u.id)))
      .returning();
    if (!row) throw notFound();
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: u.id, action: "token.revoked", data: { name: row.name } });
    return c.json({ ok: true });
  });

  /* ----------------------------- webhooks ----------------------------- */

  async function checkUrl(url: string) {
    try {
      await assertSafeUrl(url, deps.allowPrivateWebhooks);
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw new ApiError(400, "unsafeUrl");
      throw e;
    }
  }

  app.get("/workspaces/:slug/webhooks", guard("webhook.manage"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        createdAt: webhook.createdAt,
        failing: sql<number>`(select count(*) from ${webhookDelivery} d where d.webhook_id = ${webhook.id} and d.status = 'failed' and d.created_at > now() - interval '1 day')`,
      })
      .from(webhook)
      .where(eq(webhook.workspaceId, m.workspaceId))
      .orderBy(asc(webhook.createdAt));
    return c.json({ webhooks: rows.map((r) => ({ ...r, failing: Number(r.failing) })) });
  });

  /** The signing secret is returned once, at creation. */
  app.post("/workspaces/:slug/webhooks", guard("webhook.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, createWebhookSchema);
    await checkUrl(input.url);
    const secret = `whsec_${randomSecret()}`;
    const [row] = await db
      .insert(webhook)
      .values({
        workspaceId: m.workspaceId,
        url: input.url,
        events: [...new Set(input.events)],
        secret: sealer.seal(secret),
        createdBy: requireUser(c).id,
      })
      .returning({ id: webhook.id, url: webhook.url, events: webhook.events });
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "webhook.created", data: { url: input.url } });
    return c.json({ webhook: { ...row, secret } }, 201);
  });

  app.patch("/workspaces/:slug/webhooks/:id", guard("webhook.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, createWebhookSchema.partial().extend({ active: z.boolean().optional() }));
    if (input.url) await checkUrl(input.url);
    const [row] = await db
      .update(webhook)
      .set(input)
      .where(and(eq(webhook.id, c.req.param("id")), eq(webhook.workspaceId, m.workspaceId)))
      .returning({ id: webhook.id });
    if (!row) throw notFound();
    return c.json({ ok: true });
  });

  app.delete("/workspaces/:slug/webhooks/:id", guard("webhook.manage"), async (c) => {
    const m = c.get("membership");
    const del = await db
      .delete(webhook)
      .where(and(eq(webhook.id, c.req.param("id")), eq(webhook.workspaceId, m.workspaceId)))
      .returning();
    if (!del.length) throw notFound();
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "webhook.deleted", data: { url: del[0]!.url } });
    return c.json({ ok: true });
  });

  app.get("/workspaces/:slug/webhooks/:id/deliveries", guard("webhook.manage"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({
        id: webhookDelivery.id,
        event: webhookDelivery.event,
        status: webhookDelivery.status,
        attempts: webhookDelivery.attempts,
        lastStatusCode: webhookDelivery.lastStatusCode,
        lastError: webhookDelivery.lastError,
        createdAt: webhookDelivery.createdAt,
        deliveredAt: webhookDelivery.deliveredAt,
      })
      .from(webhookDelivery)
      .where(and(eq(webhookDelivery.webhookId, c.req.param("id")), eq(webhookDelivery.workspaceId, m.workspaceId)))
      .orderBy(desc(webhookDelivery.createdAt))
      .limit(50);
    return c.json({ deliveries: rows });
  });

  /* --------------------------- integrations --------------------------- */

  const endpointFor = (id: string, provider: string) => `${baseUrl}/api/integrations/${id}/${provider}`;

  app.get("/workspaces/:slug/integrations", guard("integration.manage"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({ id: integration.id, provider: integration.provider, name: integration.name, config: integration.config, lastEventAt: integration.lastEventAt })
      .from(integration)
      .where(eq(integration.workspaceId, m.workspaceId))
      .orderBy(asc(integration.createdAt));
    return c.json({
      integrations: rows.map((r) => ({
        ...r,
        endpoint: endpointFor(r.id, r.provider),
        config: { ...DEFAULT_PR_MAPPING, ...(r.config as object) },
      })),
    });
  });

  /** Returns the URL and secret to paste into the GitHub/GitLab webhook form. */
  app.post("/workspaces/:slug/integrations", guard("integration.manage"), async (c) => {
    const m = c.get("membership");
    const input = await parseBody(c, createIntegrationSchema);
    const secret = randomSecret();
    const [row] = await db
      .insert(integration)
      .values({ workspaceId: m.workspaceId, provider: input.provider, name: input.name, secret: sealer.seal(secret), config: DEFAULT_PR_MAPPING })
      .returning({ id: integration.id, provider: integration.provider, name: integration.name });
    await recordAudit(db, {
      workspaceId: m.workspaceId,
      actorId: requireUser(c).id,
      action: "integration.connected",
      data: { provider: input.provider, name: input.name },
    });
    return c.json({ integration: { ...row, endpoint: endpointFor(row!.id, row!.provider), secret } }, 201);
  });

  app.patch("/workspaces/:slug/integrations/:id", guard("integration.manage"), async (c) => {
    const m = c.get("membership");
    const config = await parseBody(c, prMappingSchema);
    const [row] = await db
      .update(integration)
      .set({ config })
      .where(and(eq(integration.id, c.req.param("id")), eq(integration.workspaceId, m.workspaceId)))
      .returning({ id: integration.id });
    if (!row) throw notFound();
    return c.json({ ok: true });
  });

  app.delete("/workspaces/:slug/integrations/:id", guard("integration.manage"), async (c) => {
    const m = c.get("membership");
    const del = await db
      .delete(integration)
      .where(and(eq(integration.id, c.req.param("id")), eq(integration.workspaceId, m.workspaceId)))
      .returning();
    if (!del.length) throw notFound();
    await recordAudit(db, {
      workspaceId: m.workspaceId,
      actorId: requireUser(c).id,
      action: "integration.disconnected",
      data: { provider: del[0]!.provider, name: del[0]!.name },
    });
    return c.json({ ok: true });
  });

  /* ---------------------- incoming Git provider events ---------------------- */

  async function loadIntegration(id: string, provider: string) {
    if (!z.string().uuid().safeParse(id).success) throw notFound();
    const [row] = await db
      .select()
      .from(integration)
      .where(and(eq(integration.id, id), eq(integration.provider, provider)));
    if (!row) throw notFound();
    return { ...row, plainSecret: sealer.open(row.secret), mapping: { ...DEFAULT_PR_MAPPING, ...(row.config as object) } };
  }

  app.post("/integrations/:id/github", async (c) => {
    const integ = await loadIntegration(c.req.param("id"), "github");
    const raw = await c.req.text();
    const sig = c.req.header("x-hub-signature-256") ?? "";
    if (!safeEqual(sig, `sha256=${hmacSha256(integ.plainSecret, raw)}`)) throw unauthorized();
    const event = c.req.header("x-github-event");
    let body: Record<string, any>;
    try {
      body = JSON.parse(raw);
    } catch {
      throw invalid();
    }
    await db.update(integration).set({ lastEventAt: new Date() }).where(eq(integration.id, integ.id));
    if (event === "pull_request") {
      const pr = body.pull_request ?? {};
      const action: string = body.action ?? "";
      const lifecycle: PrEvent | null = pr.merged
        ? "merged"
        : pr.state === "closed"
          ? "closed"
          : action === "review_requested"
            ? "reviewRequested"
            : pr.draft
              ? "draft"
              : ["opened", "reopened", "ready_for_review"].includes(action)
                ? "open"
                : null;
      await handlePullRequest(db, deps, integ, {
        provider: "github",
        externalId: `${body.repository?.full_name}#${pr.number}`,
        url: pr.html_url,
        title: pr.title,
        body: pr.body,
        branch: pr.head?.ref,
        state: pr.merged ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open",
        lifecycle,
      });
    } else if (event === "push") {
      const defaultRef = `refs/heads/${body.repository?.default_branch ?? "main"}`;
      await handlePush(db, deps, integ, {
        provider: "github",
        onDefaultBranch: body.ref === defaultRef,
        branch: String(body.ref ?? "").replace("refs/heads/", ""),
        commits: (body.commits ?? []).map((cm: any) => ({ id: cm.id, message: cm.message, url: cm.url })),
      });
    }
    return c.json({ ok: true });
  });

  app.post("/integrations/:id/gitlab", async (c) => {
    const integ = await loadIntegration(c.req.param("id"), "gitlab");
    if (!safeEqual(c.req.header("x-gitlab-token") ?? "", integ.plainSecret)) throw unauthorized();
    const body = (await c.req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) throw invalid();
    await db.update(integration).set({ lastEventAt: new Date() }).where(eq(integration.id, integ.id));
    const kind = c.req.header("x-gitlab-event");
    if (kind === "Merge Request Hook") {
      const mr = body.object_attributes ?? {};
      const draft = !!(mr.draft ?? mr.work_in_progress);
      const lifecycle: PrEvent | null =
        mr.state === "merged" ? "merged" : mr.state === "closed" ? "closed" : draft ? "draft" : ["open", "reopen"].includes(mr.action) ? "open" : null;
      await handlePullRequest(db, deps, integ, {
        provider: "gitlab",
        externalId: `${body.project?.path_with_namespace}!${mr.iid}`,
        url: mr.url,
        title: mr.title,
        body: mr.description,
        branch: mr.source_branch,
        state: mr.state === "merged" ? "merged" : mr.state === "closed" ? "closed" : draft ? "draft" : "open",
        lifecycle,
      });
    } else if (kind === "Push Hook") {
      await handlePush(db, deps, integ, {
        provider: "gitlab",
        onDefaultBranch: body.ref === `refs/heads/${body.project?.default_branch ?? "main"}`,
        branch: String(body.ref ?? "").replace("refs/heads/", ""),
        commits: (body.commits ?? []).map((cm: any) => ({ id: cm.id, message: cm.message, url: cm.url })),
      });
    }
    return c.json({ ok: true });
  });

  /* ----------------------------- issue links ---------------------------- */

  app.get("/workspaces/:slug/issues/:id/links", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const row = await getIssue(db, m.workspaceId, eq(issue.id, c.req.param("id")));
    if (!row) throw notFound();
    const links = await db
      .select()
      .from(issueLink)
      .where(eq(issueLink.issueId, row.id))
      .orderBy(desc(issueLink.updatedAt));
    return c.json({ links, branch: branchName(row.key, row.title) });
  });

  /* ------------------------------ releases ------------------------------ */

  async function projectIn(workspaceId: string, projectId: string) {
    const [p] = await db
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)));
    if (!p) throw notFound();
    return p;
  }

  app.get("/workspaces/:slug/projects/:projectId/releases", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const p = await projectIn(m.workspaceId, c.req.param("projectId"));
    const rows = await db
      .select({
        id: release.id,
        version: release.version,
        name: release.name,
        notes: release.notes,
        releasedAt: release.releasedAt,
        createdAt: release.createdAt,
        issueCount: sql<number>`(select count(*) from ${releaseIssue} ri where ri.release_id = ${release.id})`,
      })
      .from(release)
      .where(eq(release.projectId, p.id))
      .orderBy(desc(release.createdAt));
    return c.json({ releases: rows.map((r) => ({ ...r, issueCount: Number(r.issueCount) })) });
  });

  /**
   * Completed issues not yet in any release, as a starting point for the
   * next release, with Markdown notes grouped by issue type.
   */
  app.get("/workspaces/:slug/projects/:projectId/releases/draft", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const p = await projectIn(m.workspaceId, c.req.param("projectId"));
    const done = await listIssues(db, m.workspaceId, { projectId: p.id, stateCategory: ["completed"] }, 1000);
    const released = done.length
      ? await db
          .select({ id: releaseIssue.issueId })
          .from(releaseIssue)
          .where(inArray(releaseIssue.issueId, done.map((d) => d.id)))
      : [];
    const taken = new Set(released.map((r) => r.id));
    const pending = done.filter((d) => !taken.has(d.id));
    return c.json({ issues: pending });
  });

  app.post("/workspaces/:slug/projects/:projectId/releases", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const p = await projectIn(m.workspaceId, c.req.param("projectId"));
    const { issueIds = [], ...input } = await parseBody(c, releaseSchema);
    if (issueIds.length) {
      const rows = await db
        .select({ id: issue.id })
        .from(issue)
        .where(and(eq(issue.projectId, p.id), inArray(issue.id, issueIds)));
      if (rows.length !== new Set(issueIds).size) throw invalid();
    }
    const created = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(release)
        .values({ ...input, workspaceId: m.workspaceId, projectId: p.id })
        .onConflictDoNothing()
        .returning();
      if (!r) throw new ApiError(409, "nameTaken");
      if (issueIds.length) await tx.insert(releaseIssue).values([...new Set(issueIds)].map((issueId) => ({ releaseId: r.id, issueId })));
      return r;
    });
    await events.publish({ workspaceId: m.workspaceId, entity: "release" }).catch(() => {});
    return c.json({ release: created }, 201);
  });

  app.post("/workspaces/:slug/releases/:id/publish", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const published = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(release)
        .set({ releasedAt: new Date() })
        .where(and(eq(release.id, c.req.param("id")), eq(release.workspaceId, m.workspaceId), isNull(release.releasedAt)))
        .returning();
      if (!r) throw notFound();
      const items = await tx
        .select({ id: issue.id, number: issue.number, title: issue.title, type: issue.type })
        .from(releaseIssue)
        .innerJoin(issue, eq(issue.id, releaseIssue.issueId))
        .where(eq(releaseIssue.releaseId, r.id));
      await enqueueWebhooks(tx, m.workspaceId, "release.published", { release: r, issues: items });
      return r;
    });
    await events.publish({ workspaceId: m.workspaceId, entity: "release" }).catch(() => {});
    return c.json({ release: published });
  });

  app.get("/workspaces/:slug/releases/:id", guard("issue.read"), async (c) => {
    const m = c.get("membership");
    const [r] = await db
      .select()
      .from(release)
      .where(and(eq(release.id, c.req.param("id")), eq(release.workspaceId, m.workspaceId)));
    if (!r) throw notFound();
    const ids = await db.select({ id: releaseIssue.issueId }).from(releaseIssue).where(eq(releaseIssue.releaseId, r.id));
    const items = ids.length ? await listIssues(db, m.workspaceId, { projectId: r.projectId, includeClosed: true }, 2000) : [];
    const set = new Set(ids.map((x) => x.id));
    return c.json({ release: r, issues: items.filter((i) => set.has(i.id)) });
  });

  app.delete("/workspaces/:slug/releases/:id", guard("planning.manage"), async (c) => {
    const m = c.get("membership");
    const del = await db
      .delete(release)
      .where(and(eq(release.id, c.req.param("id")), eq(release.workspaceId, m.workspaceId)))
      .returning();
    if (!del.length) throw notFound();
    return c.json({ ok: true });
  });

  /* ------------------------- test delivery (admin) ------------------------ */

  /** Sends due deliveries now; handy right after creating a webhook. */
  app.post("/workspaces/:slug/webhooks/:id/ping", guard("webhook.manage"), async (c) => {
    const m = c.get("membership");
    const [h] = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.id, c.req.param("id")), eq(webhook.workspaceId, m.workspaceId)));
    if (!h) throw notFound();
    await db.insert(webhookDelivery).values({
      workspaceId: m.workspaceId,
      webhookId: h.id,
      event: "ping",
      payload: { event: "ping", createdAt: new Date().toISOString(), data: {} },
    });
    await processDeliveries(db, { sealer, allowPrivate: deps.allowPrivateWebhooks, fetchImpl: deps.webhookFetch });
    return c.json({ ok: true });
  });

  return app;
}

/* =================== shared handlers for Git providers =================== */

type Integ = { id: string; workspaceId: string; mapping: typeof DEFAULT_PR_MAPPING };

async function resolveKeys(db: Database, workspaceId: string, keys: string[]) {
  if (!keys.length) return [];
  const parts = keys.map((k) => {
    const [key, n] = k.split("-");
    return { key: key!, number: Number(n) };
  });
  const rows = await db
    .select({
      id: issue.id,
      key: sql<string>`${project.key} || '-' || ${issue.number}`,
      projectId: issue.projectId,
      category: workflowState.category,
    })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(
      and(
        eq(issue.workspaceId, workspaceId),
        sql`(${project.key}, ${issue.number}) in (${sql.join(
          parts.map((p) => sql`(${p.key}, ${p.number})`),
          sql`, `,
        )})`,
      ),
    );
  return rows;
}

async function moveTo(
  db: Database,
  deps: AppDeps,
  integ: Integ,
  provider: string,
  target: { id: string; projectId: string; category: string },
  lifecycle: PrEvent,
) {
  const want = integ.mapping[lifecycle];
  if (!want) return;
  const rank: Record<string, number> = { triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 4, canceled: 4 };
  // Never move work backwards or reopen finished work automatically.
  if (rank[target.category]! >= rank[want]! && !(lifecycle === "reviewRequested" && integ.mapping.reviewStateName)) return;
  if (target.category === "completed" || target.category === "canceled") return;
  const states = await db
    .select()
    .from(workflowState)
    .where(eq(workflowState.projectId, target.projectId))
    .orderBy(asc(workflowState.position));
  const named =
    lifecycle === "reviewRequested" && integ.mapping.reviewStateName
      ? states.find((s) => s.name.toLowerCase() === integ.mapping.reviewStateName!.toLowerCase())
      : undefined;
  const state = named ?? states.find((s) => s.category === want);
  if (!state) return;
  await updateIssue({ db, events: deps.events, workspaceId: integ.workspaceId, actorId: null, source: provider }, target.id, {
    stateId: state.id,
  });
}

async function upsertLink(
  db: Database,
  workspaceId: string,
  issueId: string,
  link: { provider: string; kind: string; externalId: string; url: string; title: string | null; state: string | null },
) {
  await db
    .insert(issueLink)
    .values({ workspaceId, issueId, ...link })
    .onConflictDoUpdate({
      target: [issueLink.issueId, issueLink.provider, issueLink.kind, issueLink.externalId],
      set: { url: link.url, title: link.title, state: link.state, updatedAt: new Date() },
    });
}

async function handlePullRequest(
  db: Database,
  deps: AppDeps,
  integ: Integ,
  pr: {
    provider: string;
    externalId: string;
    url: string;
    title: string;
    body: string | null;
    branch: string | null;
    state: string;
    lifecycle: PrEvent | null;
  },
) {
  const fromText = findIssueKeys(`${pr.title ?? ""}\n${pr.body ?? ""}`);
  const fromBranch = keysFromBranch(pr.branch);
  // Branch keys and closing words move issues; plain mentions only link.
  const moving = new Set([...fromBranch, ...fromText.filter((k) => k.intent === "closes").map((k) => k.key)]);
  const all = [...new Set([...fromBranch, ...fromText.map((k) => k.key)])];
  const found = await resolveKeys(db, integ.workspaceId, all);
  for (const target of found) {
    await upsertLink(db, integ.workspaceId, target.id, {
      provider: pr.provider,
      kind: "pull_request",
      externalId: pr.externalId,
      url: pr.url,
      title: pr.title,
      state: pr.state,
    });
    if (pr.lifecycle && moving.has(target.key)) await moveTo(db, deps, integ, pr.provider, target, pr.lifecycle);
    await deps.events.publish({ workspaceId: integ.workspaceId, entity: "issue", id: target.id }).catch(() => {});
  }
}

async function handlePush(
  db: Database,
  deps: AppDeps,
  integ: Integ,
  push: { provider: string; onDefaultBranch: boolean; branch: string; commits: { id: string; message: string; url: string }[] },
) {
  for (const cm of push.commits.slice(0, 100)) {
    const keys = findIssueKeys(cm.message);
    const found = await resolveKeys(db, integ.workspaceId, keys.map((k) => k.key));
    for (const target of found) {
      await upsertLink(db, integ.workspaceId, target.id, {
        provider: push.provider,
        kind: "commit",
        externalId: cm.id,
        url: cm.url,
        title: cm.message.split("\n")[0]!.slice(0, 200),
        state: null,
      });
      const closes = keys.find((k) => k.key === target.key)?.intent === "closes";
      if (closes && push.onDefaultBranch) await moveTo(db, deps, integ, push.provider, target, "merged");
      await deps.events.publish({ workspaceId: integ.workspaceId, entity: "issue", id: target.id }).catch(() => {});
    }
  }
}

