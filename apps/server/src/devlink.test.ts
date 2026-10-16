import { webhookDelivery } from "@veloq/db";
import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSealer } from "./crypto.js";
import { processDeliveries } from "./services/webhooks.js";
import { isPrivateAddress } from "./ssrf.js";
import { setupTestApp } from "./test-utils.js";

const t = setupTestApp();
beforeAll(() => t.migrate());
afterAll(() => t.close());
beforeEach(() => {
  t.sent.length = 0;
  t.webhookStatus.value = 200;
  return t.reset();
});

const sealer = createSealer("test-secret-test-secret-test-secret!!");
type State = { id: string; name: string; category: string };

async function world() {
  const owner = await t.signUp("Owner");
  await owner.call("POST", "/workspaces", { name: "Acme", slug: "acme" });
  const member = await t.signUp("Member");
  await owner.call("POST", "/workspaces/acme/members", { email: member.email, role: "member" });
  const p = await owner.json<{ project: { id: string } }>("POST", "/workspaces/acme/projects", { name: "Core", key: "VEL" });
  const pid = p.data.project.id;
  const states = (await owner.json<{ states: State[] }>("GET", `/workspaces/acme/projects/${pid}`)).data.states;
  const issue = async (title = "x", extra: Record<string, unknown> = {}) =>
    (await owner.json<{ issue: { id: string; key: string } }>("POST", "/workspaces/acme/issues", { projectId: pid, title, ...extra })).data.issue;
  const get = async (id: string) =>
    (await owner.json<{ issue: { stateCategory: string; stateName: string } }>("GET", `/workspaces/acme/issues/${id}`)).data.issue;
  return { owner, member, pid, states, issue, get };
}

const bearer = (token: string, method: string, path: string, body?: unknown) =>
  t.app.request(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

describe("API tokens", () => {
  it("authenticates with a bearer token scoped to one workspace", async () => {
    const w = await world();
    await w.owner.call("POST", "/workspaces", { name: "Other", slug: "other" });
    const r = await w.member.json<{ token: { value: string; prefix: string } }>("POST", "/workspaces/acme/tokens", {
      name: "CI",
      scopes: ["read", "write"],
    });
    const token = r.data.token.value;
    expect(token.startsWith("vlq_")).toBe(true);
    const created = await bearer(token, "POST", "/workspaces/acme/issues", { projectId: w.pid, title: "From CI" });
    expect(created.status).toBe(201);
    const me = await (await bearer(token, "GET", "/workspaces")).json();
    expect((me as { workspaces: { slug: string }[] }).workspaces.map((x) => x.slug)).toEqual(["acme"]);
    // A token cannot mint more tokens.
    expect((await bearer(token, "POST", "/workspaces/acme/tokens", { name: "x", scopes: ["read"] })).status).toBe(403);
  });

  it("enforces read-only scope, revocation and the token's workspace", async () => {
    const w = await world();
    await w.owner.call("POST", "/workspaces", { name: "Other", slug: "other" });
    const ro = (await w.owner.json<{ token: { id: string; value: string } }>("POST", "/workspaces/acme/tokens", { name: "RO", scopes: ["read"] })).data.token;
    expect((await bearer(ro.value, "GET", "/workspaces/acme/issues")).status).toBe(200);
    expect((await bearer(ro.value, "POST", "/workspaces/acme/issues", { projectId: w.pid, title: "x" })).status).toBe(403);
    expect((await bearer(ro.value, "GET", "/workspaces/other")).status).toBe(404);
    await w.owner.call("DELETE", `/workspaces/acme/tokens/${ro.id}`);
    expect((await bearer(ro.value, "GET", "/workspaces/acme/issues")).status).toBe(401);
    expect((await bearer("vlq_nonsense", "GET", "/me")).status).toBe(401);
  });
});

describe("webhooks", () => {
  it("refuses private and local addresses", async () => {
    const w = await world();
    for (const url of ["http://localhost/x", "http://127.0.0.1/x", "http://10.1.2.3/x", "http://[::1]/x", "ftp://93.184.215.14/x", "http://169.254.169.254/latest"]) {
      const r = await w.owner.json("POST", "/workspaces/acme/webhooks", { url, events: ["issue.created"] });
      expect(r.status, url).toBe(400);
    }
    expect(isPrivateAddress("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    // The URL parser rewrites [::ffff:127.0.0.1] to this spelling.
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isPrivateAddress("64:ff9b::a00:1")).toBe(true);
    expect(isPrivateAddress("2002:7f00:1::")).toBe(true);
    expect(isPrivateAddress("::ffff:808:808")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });

  it("only admins manage webhooks", async () => {
    const w = await world();
    expect((await w.member.call("POST", "/workspaces/acme/webhooks", { url: "https://93.184.215.14/h", events: ["issue.created"] })).status).toBe(403);
  });

  it("delivers signed events from the same transaction as the change", async () => {
    const w = await world();
    const hook = (
      await w.owner.json<{ webhook: { secret: string } }>("POST", "/workspaces/acme/webhooks", {
        url: "https://93.184.215.14/hook",
        events: ["issue.created", "issue.updated", "comment.created"],
      })
    ).data.webhook;
    const i = await w.issue("Webhook me");
    await w.owner.call("PATCH", `/workspaces/acme/issues/${i.id}`, { priority: 1 });
    await w.owner.call("POST", `/workspaces/acme/issues/${i.id}/comments`, { body: "hi" });
    const n = await processDeliveries(t.db, { sealer, allowPrivate: false, fetchImpl: t.app && ((u, init) => {
      t.sent.push({ url: String(u), init: init ?? {} });
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch });
    expect(n).toBe(3);
    const events = t.sent.map((s) => (s.init.headers as Record<string, string>)["x-veloq-event"]);
    expect(events.sort()).toEqual(["comment.created", "issue.created", "issue.updated"]);
    for (const s of t.sent) {
      const body = String(s.init.body);
      const sig = (s.init.headers as Record<string, string>)["x-veloq-signature"];
      expect(sig).toBe(`sha256=${createHmac("sha256", hook.secret).update(body).digest("hex")}`);
    }
    const updated = JSON.parse(String(t.sent.find((s) => String(s.init.body).includes("issue.updated"))!.init.body));
    expect(updated.data.issue.key).toBe("VEL-1");
    expect(updated.data.changes).toEqual([{ field: "priority", from: 0, to: 1 }]);
  });

  it("retries failures with backoff and gives up after the limit", async () => {
    const w = await world();
    await w.owner.json("POST", "/workspaces/acme/webhooks", { url: "https://93.184.215.14/hook", events: ["issue.created"] });
    await w.issue();
    const failing = (() => Promise.resolve(new Response("no", { status: 500 }))) as typeof fetch;
    await processDeliveries(t.db, { sealer, allowPrivate: false, fetchImpl: failing });
    let [d] = await t.db.select().from(webhookDelivery);
    expect(d).toMatchObject({ status: "pending", attempts: 1, lastStatusCode: 500 });
    expect(d!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    // Nothing is due yet, so nothing is sent.
    expect(await processDeliveries(t.db, { sealer, allowPrivate: false, fetchImpl: failing })).toBe(0);
    for (let k = 0; k < 7; k++) {
      await t.db.execute(sql`update webhook_delivery set next_attempt_at = now() - interval '1 second'`);
      await processDeliveries(t.db, { sealer, allowPrivate: false, fetchImpl: failing });
    }
    [d] = await t.db.select().from(webhookDelivery);
    expect(d).toMatchObject({ status: "failed", attempts: 8 });
  });

  it("stores secrets encrypted", async () => {
    const w = await world();
    const hook = (await w.owner.json<{ webhook: { id: string; secret: string } }>("POST", "/workspaces/acme/webhooks", {
      url: "https://93.184.215.14/hook",
      events: ["issue.created"],
    })).data.webhook;
    const rows = (await t.db.execute(sql`select secret from webhook where id = ${hook.id}`)) as unknown as { secret: string }[];
    expect(rows[0]!.secret).not.toContain(hook.secret);
    expect(sealer.open(rows[0]!.secret)).toBe(hook.secret);
  });
});

describe("GitHub and GitLab", () => {
  async function connect(w: Awaited<ReturnType<typeof world>>, provider: "github" | "gitlab") {
    return (
      await w.owner.json<{ integration: { id: string; endpoint: string; secret: string } }>("POST", "/workspaces/acme/integrations", {
        provider,
        name: "repo",
      })
    ).data.integration;
  }
  const github = (integ: { id: string; secret: string }, event: string, payload: unknown, badSig = false) => {
    const body = JSON.stringify(payload);
    const sig = createHmac("sha256", badSig ? "wrong" : integ.secret).update(body).digest("hex");
    return t.app.request(`/api/integrations/${integ.id}/github`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": `sha256=${sig}` },
      body,
    });
  };
  const pr = (extra: Record<string, unknown>, action = "opened") => ({
    action,
    repository: { full_name: "acme/app", default_branch: "main" },
    pull_request: { number: 7, html_url: "https://github.com/acme/app/pull/7", title: "Login", body: "", head: { ref: "feature" }, state: "open", draft: false, merged: false, ...extra },
  });

  it("rejects bad signatures", async () => {
    const w = await world();
    const integ = await connect(w, "github");
    expect((await github(integ, "ping", {}, true)).status).toBe(401);
    expect((await github(integ, "ping", {})).status).toBe(200);
  });

  it("moves issues through the PR lifecycle via branch names", async () => {
    const w = await world();
    const integ = await connect(w, "github");
    const i = await w.issue("Login page");
    await github(integ, "pull_request", pr({ head: { ref: "vel-1-login-page" }, draft: true }));
    expect((await w.get(i.id)).stateCategory).toBe("started");
    const links = await w.owner.json<{ links: { kind: string; state: string; url: string }[]; branch: string }>("GET", `/workspaces/acme/issues/${i.id}/links`);
    expect(links.data.links).toEqual([expect.objectContaining({ kind: "pull_request", state: "draft" })]);
    expect(links.data.branch).toBe("vel-1-login-page");
    await github(integ, "pull_request", pr({ head: { ref: "vel-1-login-page" }, state: "closed", merged: true }, "closed"));
    expect((await w.get(i.id)).stateCategory).toBe("completed");
    const act = await w.owner.json<{ activity: { field: string; source?: string }[] }>("GET", `/workspaces/acme/issues/${i.id}/activity`);
    expect(act.data.activity.filter((a) => a.field === "state")).toHaveLength(2);
  });

  it("closes only issues named with closing words; plain mentions just link", async () => {
    const w = await world();
    const integ = await connect(w, "github");
    const a = await w.issue("A");
    const b = await w.issue("B");
    const body = { body: "Fixes VEL-1. Related to VEL-2", state: "closed", merged: true };
    await github(integ, "pull_request", pr(body, "closed"));
    expect((await w.get(a.id)).stateCategory).toBe("completed");
    expect((await w.get(b.id)).stateCategory).toBe("backlog");
    const links = await w.owner.json<{ links: unknown[] }>("GET", `/workspaces/acme/issues/${b.id}/links`);
    expect(links.data.links).toHaveLength(1);
  });

  it("uses a named review state when configured", async () => {
    const w = await world();
    const integ = await connect(w, "github");
    await w.owner.call("PATCH", `/workspaces/acme/integrations/${integ.id}`, {
      draft: "started",
      open: "started",
      reviewRequested: "started",
      merged: "completed",
      closed: null,
      // Default workflow has two "started" states; the second is "In review".
      reviewStateName: w.states.filter((s) => s.category === "started")[1]!.name,
    });
    const i = await w.issue();
    await github(integ, "pull_request", pr({ head: { ref: "vel-1" } }, "opened"));
    await github(integ, "pull_request", pr({ head: { ref: "vel-1" } }, "review_requested"));
    const second = w.states.filter((s) => s.category === "started")[1]!;
    expect((await w.get(i.id)).stateName).toBe(second.name);
  });

  it("closes from commits pushed to the default branch only", async () => {
    const w = await world();
    const integ = await connect(w, "github");
    const a = await w.issue();
    const b = await w.issue();
    const push = (ref: string, message: string) =>
      github(integ, "push", {
        ref,
        repository: { full_name: "acme/app", default_branch: "main" },
        commits: [{ id: `sha-${ref}-${message.length}`, message, url: "https://github.com/acme/app/commit/1" }],
      });
    await push("refs/heads/feature", "Fixes VEL-1");
    expect((await w.get(a.id)).stateCategory).toBe("backlog");
    await push("refs/heads/main", "Fixes VEL-1\n\nlonger body");
    expect((await w.get(a.id)).stateCategory).toBe("completed");
    await push("refs/heads/main", "skip VEL-2 cleanup");
    const lb = await w.owner.json<{ links: unknown[] }>("GET", `/workspaces/acme/issues/${b.id}/links`);
    expect(lb.data.links).toHaveLength(0);
  });

  it("accepts GitLab merge requests with the shared token", async () => {
    const w = await world();
    const integ = await connect(w, "gitlab");
    const i = await w.issue();
    const send = (token: string) =>
      t.app.request(`/api/integrations/${integ.id}/gitlab`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-gitlab-event": "Merge Request Hook", "x-gitlab-token": token },
        body: JSON.stringify({
          project: { path_with_namespace: "acme/app", default_branch: "main" },
          object_attributes: { iid: 3, title: "Closes VEL-1", description: "", source_branch: "x", state: "merged", action: "merge", url: "https://gitlab.com/acme/app/-/merge_requests/3" },
        }),
      });
    expect((await send("nope")).status).toBe(401);
    expect((await send(integ.secret)).status).toBe(200);
    expect((await w.get(i.id)).stateCategory).toBe("completed");
  });

  it("ignores issue keys from other workspaces", async () => {
    const w = await world();
    const other = await t.signUp("Other");
    await other.call("POST", "/workspaces", { name: "O", slug: "oth" });
    const op = (await other.json<{ project: { id: string } }>("POST", "/workspaces/oth/projects", { name: "X", key: "VEL" })).data.project;
    const theirs = (await other.json<{ issue: { id: string } }>("POST", "/workspaces/oth/issues", { projectId: op.id, title: "theirs" })).data.issue;
    const integ = await connect(w, "github");
    await github(integ, "pull_request", pr({ body: "Fixes VEL-1", state: "closed", merged: true }, "closed"));
    const st = await other.json<{ issue: { stateCategory: string } }>("GET", `/workspaces/oth/issues/${theirs.id}`);
    expect(st.data.issue.stateCategory).toBe("backlog");
  });
});

describe("releases", () => {
  it("drafts from completed issues and announces on publish", async () => {
    const w = await world();
    await w.owner.json("POST", "/workspaces/acme/webhooks", { url: "https://93.184.215.14/hook", events: ["release.published"] });
    const done = w.states.find((s) => s.category === "completed")!.id;
    const a = await w.issue("Dark mode", { stateId: done, type: "feature" });
    await w.issue("Open work");
    const draft = await w.owner.json<{ issues: { id: string }[] }>("GET", `/workspaces/acme/projects/${w.pid}/releases/draft`);
    expect(draft.data.issues.map((i) => i.id)).toEqual([a.id]);
    const rel = (
      await w.owner.json<{ release: { id: string } }>("POST", `/workspaces/acme/projects/${w.pid}/releases`, {
        version: "1.0.0",
        issueIds: [a.id],
      })
    ).data.release;
    expect((await w.owner.call("POST", `/workspaces/acme/projects/${w.pid}/releases`, { version: "1.0.0" })).status).toBe(409);
    await w.owner.call("POST", `/workspaces/acme/releases/${rel.id}/publish`);
    const after = await w.owner.json<{ issues: unknown[] }>("GET", `/workspaces/acme/projects/${w.pid}/releases/draft`);
    expect(after.data.issues).toHaveLength(0);
    const pending = await t.db.select().from(webhookDelivery).where(eq(webhookDelivery.event, "release.published"));
    expect(pending).toHaveLength(1);
  });
});

describe("API surface", () => {
  it("serves an OpenAPI document built from the validation schemas", async () => {
    const r = await t.app.request("/api/openapi.json");
    const doc = (await r.json()) as { openapi: string; paths: Record<string, Record<string, { requestBody?: unknown }>> };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/workspaces/{slug}/issues"]?.post?.requestBody).toBeTruthy();
  });
});
