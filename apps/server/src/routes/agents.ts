import { apiToken, projectAccess, project, user, workspaceMember } from "@kadrix/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { type AppDeps, type Env, parseBody, requireUser, workspaceGuard } from "../context.js";
import { generateToken } from "../crypto.js";
import { ApiError, invalid, notFound } from "../errors.js";

/** Agents get addresses no mail server will ever accept. */
export const AGENT_EMAIL_DOMAIN = "agents.kadrix.invalid";

const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  role: z.enum(["member", "guest"]).default("member"),
  /** Guests only: the projects the agent may work in. */
  projectIds: z.array(z.string().uuid()).max(200).default([]),
  /** Read-only agents can look but not change anything. */
  write: z.boolean().default(true),
});

/**
 * Agents are workspace members for AI coding tools and bots. They have no
 * password and act only through their API token, so everything they do
 * passes the same permission checks and shows up in history under their name.
 */
export function agentRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono<Env>();
  const guard = (a: Parameters<typeof workspaceGuard>[1]) => workspaceGuard(db, a);

  async function issueToken(workspaceId: string, userId: string, write: boolean) {
    const { token, hash, prefix } = generateToken();
    await db.insert(apiToken).values({
      workspaceId,
      userId,
      name: "agent",
      tokenHash: hash,
      prefix,
      scopes: write ? ["read", "write"] : ["read"],
    });
    return token;
  }

  app.get("/workspaces/:slug/agents", guard("member.read"), async (c) => {
    const m = c.get("membership");
    const rows = await db
      .select({ id: user.id, name: user.name, role: workspaceMember.role, createdAt: user.createdAt })
      .from(user)
      .innerJoin(workspaceMember, and(eq(workspaceMember.userId, user.id), eq(workspaceMember.workspaceId, m.workspaceId)))
      .where(and(eq(user.kind, "agent"), eq(user.agentWorkspaceId, m.workspaceId)))
      .orderBy(user.name);
    const tokens = rows.length
      ? await db
          .select({ userId: apiToken.userId, prefix: apiToken.prefix, scopes: apiToken.scopes, lastUsedAt: apiToken.lastUsedAt })
          .from(apiToken)
          .where(and(inArray(apiToken.userId, rows.map((r) => r.id)), isNull(apiToken.revokedAt)))
          .orderBy(desc(apiToken.createdAt))
      : [];
    return c.json({
      agents: rows.map((r) => {
        const tk = tokens.find((x) => x.userId === r.id);
        return { ...r, tokenPrefix: tk?.prefix ?? null, canWrite: tk?.scopes.includes("write") ?? false, lastUsedAt: tk?.lastUsedAt ?? null };
      }),
    });
  });

  app.post("/workspaces/:slug/agents", guard("agent.manage"), async (c) => {
    if (c.get("tokenWorkspaceId")) throw new ApiError(403, "forbidden");
    const m = c.get("membership");
    const input = await parseBody(c, createAgentSchema);
    if (input.projectIds.length) {
      const found = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.workspaceId, m.workspaceId), inArray(project.id, input.projectIds)));
      if (found.length !== new Set(input.projectIds).size) throw invalid();
    }
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id,
        name: input.name,
        email: `${id}@${AGENT_EMAIL_DOMAIN}`,
        emailVerified: true,
        kind: "agent",
        agentWorkspaceId: m.workspaceId,
      });
      await tx.insert(workspaceMember).values({ workspaceId: m.workspaceId, userId: id, role: input.role });
      if (input.role === "guest" && input.projectIds.length) {
        await tx.insert(projectAccess).values([...new Set(input.projectIds)].map((projectId) => ({ projectId, userId: id })));
      }
    });
    const token = await issueToken(m.workspaceId, id, input.write);
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "agent.created", targetType: "user", targetId: id, data: { targetName: input.name, role: input.role } });
    return c.json({ agent: { id, name: input.name, role: input.role }, token }, 201);
  });

  async function agentIn(workspaceId: string, id: string) {
    const [row] = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .innerJoin(workspaceMember, and(eq(workspaceMember.userId, user.id), eq(workspaceMember.workspaceId, workspaceId)))
      .where(and(eq(user.id, id), eq(user.kind, "agent"), eq(user.agentWorkspaceId, workspaceId)));
    if (!row) throw notFound();
    return row;
  }

  /** Replaces the agent's token; the old one stops working immediately. */
  app.post("/workspaces/:slug/agents/:id/token", guard("agent.manage"), async (c) => {
    if (c.get("tokenWorkspaceId")) throw new ApiError(403, "forbidden");
    const m = c.get("membership");
    const a = await agentIn(m.workspaceId, c.req.param("id"));
    const { write } = await parseBody(c, z.object({ write: z.boolean().default(true) }));
    await db.update(apiToken).set({ revokedAt: new Date() }).where(and(eq(apiToken.userId, a.id), isNull(apiToken.revokedAt)));
    const token = await issueToken(m.workspaceId, a.id, write);
    return c.json({ token });
  });

  app.delete("/workspaces/:slug/agents/:id", guard("agent.manage"), async (c) => {
    const m = c.get("membership");
    const a = await agentIn(m.workspaceId, c.req.param("id"));
    // Keep the user row so history still shows who did what; the agent
    // loses its membership and every token, so it can no longer act.
    await db.transaction(async (tx) => {
      await tx.update(apiToken).set({ revokedAt: new Date() }).where(and(eq(apiToken.userId, a.id), isNull(apiToken.revokedAt)));
      await tx.delete(projectAccess).where(eq(projectAccess.userId, a.id));
      await tx.delete(workspaceMember).where(and(eq(workspaceMember.userId, a.id), eq(workspaceMember.workspaceId, m.workspaceId)));
    });
    await recordAudit(db, { workspaceId: m.workspaceId, actorId: requireUser(c).id, action: "agent.deleted", targetType: "user", targetId: a.id, data: { targetName: a.name } });
    return c.json({ ok: true });
  });

  return app;
}
