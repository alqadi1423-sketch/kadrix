import { createDb, runMigrations } from "@veloq/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required for server tests");

const BASE = "http://localhost:3000";
const { db, client } = createDb(url);
const auth = createAuth(db, { secret: "test-secret-test-secret-test-secret!!", baseUrl: BASE });
const app = createApp({ db, auth, edition: "self-hosted" });

beforeAll(async () => {
  await runMigrations(url);
});
afterAll(async () => {
  await client.end();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user", workspace CASCADE`);
});

/** A signed-in test user with a cookie-carrying request helper. */
async function signUp(name: string) {
  const email = `${name.toLowerCase()}@example.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ name, email, password: "correct-horse-battery" }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { cookie, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  const { user } = (await (await call("GET", "/me")).json()) as { user: { id: string } };
  return { email, id: user.id, call };
}

async function setupWorkspace() {
  const owner = await signUp("Owner");
  const res = await owner.call("POST", "/workspaces", { name: "Acme", slug: "acme" });
  expect(res.status).toBe(201);
  return owner;
}

describe("authentication", () => {
  it("rejects anonymous requests", async () => {
    const res = await app.request("/api/workspaces");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("workspaces", () => {
  it("creates a workspace with the creator as owner", async () => {
    const owner = await setupWorkspace();
    const body = (await (await owner.call("GET", "/workspaces")).json()) as {
      workspaces: { slug: string; role: string }[];
    };
    expect(body.workspaces).toEqual([expect.objectContaining({ slug: "acme", role: "owner" })]);
  });

  it("refuses a taken slug", async () => {
    await setupWorkspace();
    const other = await signUp("Other");
    const res = await other.call("POST", "/workspaces", { name: "Copy", slug: "acme" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "slugTaken" });
  });

  it("rejects invalid input", async () => {
    const u = await signUp("Someone");
    const res = await u.call("POST", "/workspaces", { name: "", slug: "Bad Slug" });
    expect(res.status).toBe(400);
  });

  it("hides workspaces from non-members with 404", async () => {
    await setupWorkspace();
    const stranger = await signUp("Stranger");
    expect((await stranger.call("GET", "/workspaces/acme")).status).toBe(404);
    expect((await stranger.call("GET", "/workspaces/acme/members")).status).toBe(404);
  });
});

describe("members and roles", () => {
  it("lets the owner add members, and members cannot add others", async () => {
    const owner = await setupWorkspace();
    const member = await signUp("Member");
    const third = await signUp("Third");
    expect((await owner.call("POST", "/workspaces/acme/members", { email: member.email, role: "member" })).status).toBe(201);
    expect((await member.call("POST", "/workspaces/acme/members", { email: third.email, role: "guest" })).status).toBe(403);
  });

  it("returns userNotFound and alreadyMember", async () => {
    const owner = await setupWorkspace();
    const r1 = await owner.call("POST", "/workspaces/acme/members", { email: "nobody@example.com", role: "member" });
    expect(await r1.json()).toEqual({ error: "userNotFound" });
    const m = await signUp("Member");
    await owner.call("POST", "/workspaces/acme/members", { email: m.email, role: "member" });
    const r2 = await owner.call("POST", "/workspaces/acme/members", { email: m.email, role: "member" });
    expect(r2.status).toBe(409);
    expect(await r2.json()).toEqual({ error: "alreadyMember" });
  });

  it("stops admins from granting admin or touching owners", async () => {
    const owner = await setupWorkspace();
    const admin = await signUp("Admin");
    const m = await signUp("Member");
    await owner.call("POST", "/workspaces/acme/members", { email: admin.email, role: "admin" });
    await owner.call("POST", "/workspaces/acme/members", { email: m.email, role: "member" });
    expect((await admin.call("PATCH", `/workspaces/acme/members/${m.id}`, { role: "admin" })).status).toBe(403);
    expect((await admin.call("PATCH", `/workspaces/acme/members/${owner.id}`, { role: "member" })).status).toBe(403);
    expect((await admin.call("DELETE", `/workspaces/acme/members/${owner.id}`)).status).toBe(403);
    expect((await admin.call("PATCH", `/workspaces/acme/members/${m.id}`, { role: "guest" })).status).toBe(200);
  });

  it("guests cannot list members", async () => {
    const owner = await setupWorkspace();
    const g = await signUp("Guest");
    await owner.call("POST", "/workspaces/acme/members", { email: g.email, role: "guest" });
    expect((await g.call("GET", "/workspaces/acme")).status).toBe(200);
    expect((await g.call("GET", "/workspaces/acme/members")).status).toBe(403);
  });

  it("keeps at least one owner", async () => {
    const owner = await setupWorkspace();
    const res = await owner.call("PATCH", `/workspaces/acme/members/${owner.id}`, { role: "admin" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "lastOwner" });
    expect((await owner.call("DELETE", `/workspaces/acme/members/${owner.id}`)).status).toBe(409);
  });
});

describe("audit log", () => {
  it("records actions and is visible to admins only", async () => {
    const owner = await setupWorkspace();
    const m = await signUp("Member");
    await owner.call("POST", "/workspaces/acme/members", { email: m.email, role: "member" });
    const body = (await (await owner.call("GET", "/workspaces/acme/audit")).json()) as {
      entries: { action: string }[];
    };
    expect(body.entries.map((e) => e.action).sort()).toEqual(["member.added", "workspace.created"]);
    expect((await m.call("GET", "/workspaces/acme/audit")).status).toBe(403);
  });

  it("cannot be edited or deleted, but follows workspace and user deletion", async () => {
    const owner = await setupWorkspace();
    const dbError = (q: Promise<unknown>) =>
      q.then(
        () => "no error",
        (e: { cause?: { message?: string } }) => e.cause?.message ?? String(e),
      );
    expect(await dbError(db.execute(sql`UPDATE audit_log SET action = 'x'`))).toMatch(/append-only/);
    expect(await dbError(db.execute(sql`DELETE FROM audit_log`))).toMatch(/append-only/);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${owner.id}`);
    const [row] = (await db.execute(sql`SELECT actor_id FROM audit_log`)) as unknown as { actor_id: string | null }[];
    expect(row?.actor_id).toBeNull();
    await db.execute(sql`DELETE FROM workspace`);
    const rows = await db.execute(sql`SELECT 1 FROM audit_log`);
    expect(rows.length).toBe(0);
  });
});
