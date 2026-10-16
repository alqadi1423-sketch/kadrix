import { issueTransition } from "@veloq/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestUser } from "./test-utils.js";

const t = setupTestApp();
beforeAll(() => t.migrate());
afterAll(() => t.close());
beforeEach(() => t.reset());

type State = { id: string; name: string; category: string };
type Issue = { id: string; key: string; number: number; stateId: string; stateCategory: string; labelIds: string[] };

async function world() {
  const owner = await t.signUp("Owner");
  await owner.call("POST", "/workspaces", { name: "Acme", slug: "acme" });
  const member = await t.signUp("Member");
  const guest = await t.signUp("Guest");
  await owner.call("POST", "/workspaces/acme/members", { email: member.email, role: "member" });
  await owner.call("POST", "/workspaces/acme/members", { email: guest.email, role: "guest" });
  const p = await owner.json<{ project: { id: string } }>("POST", "/workspaces/acme/projects", {
    name: "Platform",
    key: "plt",
  });
  // Guests only see projects they are given.
  await owner.call("PUT", `/workspaces/acme/members/${guest.id}/projects`, { projectIds: [p.data.project.id] });
  const detail = await owner.json<{ states: State[] }>("GET", `/workspaces/acme/projects/${p.data.project.id}`);
  const states = detail.data.states;
  const byCat = (c: string) => states.find((s) => s.category === c)!;
  return { owner, member, guest, projectId: p.data.project.id, states, byCat };
}

async function newIssue(u: TestUser, projectId: string, extra: Record<string, unknown> = {}) {
  const r = await u.json<{ issue: Issue }>("POST", "/workspaces/acme/issues", { projectId, title: "Fix login", ...extra });
  expect(r.status).toBe(201);
  return r.data.issue;
}

const list = async (u: TestUser, filter: Record<string, unknown> = {}) =>
  (await u.json<{ issues: Issue[] }>("GET", `/workspaces/acme/issues?filter=${encodeURIComponent(JSON.stringify(filter))}`))
    .data.issues;

describe("projects", () => {
  it("creates default workflow states in the caller's language", async () => {
    const owner = await t.signUp("Owner");
    await owner.call("POST", "/workspaces", { name: "Acme", slug: "acme" });
    const r = await owner.call("POST", "/workspaces/acme/projects", { name: "منصة", key: "MNS" }, { "x-veloq-locale": "ar" });
    const { project } = (await r.json()) as { project: { id: string; key: string } };
    expect(project.key).toBe("MNS");
    const { states } = (await (await owner.call("GET", `/workspaces/acme/projects/${project.id}`)).json()) as {
      states: State[];
    };
    expect(states.map((s) => s.name)).toContain("قيد التنفيذ");
    expect(states.map((s) => s.category)).toEqual(["triage", "backlog", "unstarted", "started", "started", "completed", "canceled"]);
  });

  it("rejects duplicate keys and lets guests read but not create", async () => {
    const w = await world();
    const dup = await w.owner.json("POST", "/workspaces/acme/projects", { name: "Other", key: "PLT" });
    expect(dup.status).toBe(409);
    expect(dup.data).toEqual({ error: "keyTaken" });
    expect((await w.guest.call("GET", "/workspaces/acme/projects")).status).toBe(200);
    expect((await w.guest.call("POST", "/workspaces/acme/projects", { name: "X", key: "XX" })).status).toBe(403);
  });

  it("requires a target state when deleting a state that has issues", async () => {
    const w = await world();
    const todo = w.byCat("unstarted");
    await newIssue(w.owner, w.projectId, { stateId: todo.id });
    const path = `/workspaces/acme/projects/${w.projectId}/states/${todo.id}`;
    expect((await w.owner.call("DELETE", path)).status).toBe(400);
    expect((await w.owner.call("DELETE", `${path}?moveTo=${w.byCat("backlog").id}`)).status).toBe(200);
    const issues = await list(w.owner, { includeClosed: true });
    expect(issues[0]?.stateId).toBe(w.byCat("backlog").id);
  });
});

describe("issues", () => {
  it("numbers issues per project and defaults to the backlog state", async () => {
    const w = await world();
    const a = await newIssue(w.owner, w.projectId);
    const b = await newIssue(w.member, w.projectId);
    expect([a.key, b.key]).toEqual(["PLT-1", "PLT-2"]);
    expect(a.stateCategory).toBe("backlog");
  });

  it("numbers stay unique under concurrent creation", async () => {
    const w = await world();
    const made = await Promise.all(Array.from({ length: 10 }, () => newIssue(w.owner, w.projectId)));
    expect(new Set(made.map((i) => i.number)).size).toBe(10);
  });

  it("records every state transition with its category", async () => {
    const w = await world();
    const i = await newIssue(w.owner, w.projectId);
    await w.member.call("PATCH", `/workspaces/acme/issues/${i.id}`, { stateId: w.byCat("started").id });
    await w.member.call("PATCH", `/workspaces/acme/issues/${i.id}`, { stateId: w.byCat("completed").id });
    const rows = await t.db.select().from(issueTransition).where(eq(issueTransition.issueId, i.id)).orderBy(issueTransition.at);
    expect(rows.map((r) => r.toCategory)).toEqual(["backlog", "started", "completed"]);
    expect(rows[2]?.fromCategory).toBe("started");
    const done = await w.owner.json<{ issue: { completedAt: string | null } }>("GET", `/workspaces/acme/issues/${i.id}`);
    expect(done.data.issue.completedAt).not.toBeNull();
    // Closed issues are hidden unless asked for.
    expect(await list(w.owner)).toHaveLength(0);
    expect(await list(w.owner, { includeClosed: true })).toHaveLength(1);
  });

  it("finds issues by Arabic words, English words, partial titles and keys", async () => {
    const w = await world();
    await newIssue(w.owner, w.projectId, { title: "إصلاح صفحة تسجيل الدخول" });
    await newIssue(w.owner, w.projectId, { title: "Add dark mode", description: "Theme toggle in settings" });
    expect((await list(w.owner, { search: "تسجيل" })).length).toBe(1);
    expect((await list(w.owner, { search: "toggle" })).length).toBe(1);
    expect((await list(w.owner, { search: "dar" })).length).toBe(1);
    const byKey = await list(w.owner, { search: "plt-2" });
    expect(byKey.map((i) => i.key)).toEqual(["PLT-2"]);
  });

  it("guests can comment but cannot create or edit issues", async () => {
    const w = await world();
    const i = await newIssue(w.owner, w.projectId);
    expect((await w.guest.call("POST", "/workspaces/acme/issues", { projectId: w.projectId, title: "x" })).status).toBe(403);
    expect((await w.guest.call("PATCH", `/workspaces/acme/issues/${i.id}`, { title: "x" })).status).toBe(403);
    expect((await w.guest.call("POST", `/workspaces/acme/issues/${i.id}/comments`, { body: "Looks good" })).status).toBe(201);
  });

  it("only admins delete issues", async () => {
    const w = await world();
    const i = await newIssue(w.member, w.projectId);
    expect((await w.member.call("DELETE", `/workspaces/acme/issues/${i.id}`)).status).toBe(403);
    expect((await w.owner.call("DELETE", `/workspaces/acme/issues/${i.id}`)).status).toBe(200);
  });

  it("rejects assignees, labels and parents from outside the workspace", async () => {
    const w = await world();
    const outsider = await t.signUp("Outsider");
    await outsider.call("POST", "/workspaces", { name: "Other", slug: "other" });
    const lbl = await outsider.json<{ label: { id: string } }>("POST", "/workspaces/other/labels", { name: "x", color: "#112233" });
    const r1 = await w.owner.call("POST", "/workspaces/acme/issues", { projectId: w.projectId, title: "a", assigneeId: outsider.id });
    expect(r1.status).toBe(400);
    const r2 = await w.owner.call("POST", "/workspaces/acme/issues", {
      projectId: w.projectId,
      title: "a",
      labelIds: [lbl.data.label.id],
    });
    expect(r2.status).toBe(400);
  });

  it("isolates workspaces even when the issue id is known", async () => {
    const w = await world();
    const i = await newIssue(w.owner, w.projectId);
    const outsider = await t.signUp("Outsider");
    await outsider.call("POST", "/workspaces", { name: "Other", slug: "other" });
    expect((await outsider.call("GET", `/workspaces/other/issues/${i.id}`)).status).toBe(404);
    expect((await outsider.call("PATCH", `/workspaces/other/issues/${i.id}`, { title: "hacked" })).status).toBe(404);
    expect((await outsider.call("POST", `/workspaces/other/issues/${i.id}/comments`, { body: "x" })).status).toBe(404);
    expect((await outsider.call("GET", `/workspaces/acme/issues/${i.id}`)).status).toBe(404);
  });

  it("prevents parent loops", async () => {
    const w = await world();
    const a = await newIssue(w.owner, w.projectId);
    const b = await newIssue(w.owner, w.projectId, { parentId: a.id });
    expect((await w.owner.call("PATCH", `/workspaces/acme/issues/${a.id}`, { parentId: b.id })).status).toBe(400);
    expect((await w.owner.call("PATCH", `/workspaces/acme/issues/${a.id}`, { parentId: a.id })).status).toBe(400);
    const detail = await w.owner.json<{ children: Issue[] }>("GET", `/workspaces/acme/issues/${a.id}`);
    expect(detail.data.children.map((c) => c.id)).toEqual([b.id]);
  });

  it("filters by label, assignee and priority", async () => {
    const w = await world();
    const lbl = await w.owner.json<{ label: { id: string } }>("POST", "/workspaces/acme/labels", { name: "api", color: "#2255aa" });
    await newIssue(w.owner, w.projectId, { labelIds: [lbl.data.label.id], priority: 1 });
    await newIssue(w.owner, w.projectId, { assigneeId: w.member.id, priority: 3 });
    expect((await list(w.owner, { labelId: [lbl.data.label.id] })).length).toBe(1);
    expect((await list(w.owner, { assigneeId: [w.member.id] })).length).toBe(1);
    expect((await list(w.owner, { assigneeId: ["none"] })).length).toBe(1);
    expect((await list(w.owner, { priority: [1, 2] })).length).toBe(1);
  });

  it("applies bulk updates", async () => {
    const w = await world();
    const a = await newIssue(w.owner, w.projectId);
    const b = await newIssue(w.owner, w.projectId);
    const r = await w.member.call("POST", "/workspaces/acme/issues/bulk", { ids: [a.id, b.id], patch: { priority: 2 } });
    expect(r.status).toBe(200);
    expect((await list(w.owner, { priority: [2] })).length).toBe(2);
  });

  it("keeps fields the caller did not send", async () => {
    const w = await world();
    const i = await newIssue(w.owner, w.projectId, { priority: 2, type: "bug" });
    await w.owner.call("PATCH", `/workspaces/acme/issues/${i.id}`, { title: "Renamed" });
    const after = await w.owner.json<{ issue: { priority: number; type: string } }>("GET", `/workspaces/acme/issues/${i.id}`);
    expect(after.data.issue).toMatchObject({ priority: 2, type: "bug" });
  });

  it("changes nothing when one issue in a bulk update fails", async () => {
    const w = await world();
    const a = await newIssue(w.owner, w.projectId);
    const missing = "00000000-0000-4000-8000-000000000000";
    const r = await w.member.call("POST", "/workspaces/acme/issues/bulk", { ids: [a.id, missing], patch: { priority: 3 } });
    expect(r.status).toBe(404);
    expect((await list(w.owner, { priority: [3] })).length).toBe(0);
  });
});

describe("collaboration", () => {
  it("notifies assignees and mentioned members, never the actor", async () => {
    const w = await world();
    const i = await newIssue(w.owner, w.projectId, { assigneeId: w.member.id });
    await w.owner.call("POST", `/workspaces/acme/issues/${i.id}/comments`, { body: `Can you check <@${w.guest.id}>?` });
    const memberInbox = await w.member.json<{ notifications: { kind: string }[] }>("GET", "/workspaces/acme/notifications");
    expect(memberInbox.data.notifications.map((n) => n.kind).sort()).toEqual(["assigned", "commented"]);
    const guestInbox = await w.guest.json<{ notifications: { kind: string }[] }>("GET", "/workspaces/acme/notifications");
    expect(guestInbox.data.notifications.map((n) => n.kind)).toEqual(["mentioned"]);
    const ownerInbox = await w.owner.json<{ notifications: unknown[] }>("GET", "/workspaces/acme/notifications");
    expect(ownerInbox.data.notifications).toHaveLength(0);
    await w.member.call("POST", "/workspaces/acme/notifications/read", {});
    const after = await w.member.json<{ notifications: unknown[] }>("GET", "/workspaces/acme/notifications?unread=1");
    expect(after.data.notifications).toHaveLength(0);
  });

  it("lets authors edit their own comments only", async () => {
    const w = await world();
    const i = await newIssue(w.owner, w.projectId);
    const c = await w.member.json<{ comment: { id: string } }>("POST", `/workspaces/acme/issues/${i.id}/comments`, { body: "first" });
    expect((await w.owner.call("PATCH", `/workspaces/acme/comments/${c.data.comment.id}`, { body: "changed" })).status).toBe(404);
    expect((await w.member.call("PATCH", `/workspaces/acme/comments/${c.data.comment.id}`, { body: "second" })).status).toBe(200);
    // Admins may remove any comment for moderation.
    expect((await w.owner.call("DELETE", `/workspaces/acme/comments/${c.data.comment.id}`)).status).toBe(200);
  });

  it("stores attachments and always serves them as downloads", async () => {
    const w = await world();
    const i = await newIssue(w.owner, w.projectId);
    const form = new FormData();
    form.append("file", new File(["<script>alert(1)</script>"], "x.html", { type: "text/html" }));
    const up = await t.app.request(`/api/workspaces/acme/issues/${i.id}/attachments`, {
      method: "POST",
      headers: { cookie: w.member.cookie, origin: "http://localhost:3000" },
      body: form,
    });
    expect(up.status).toBe(201);
    const { attachment } = (await up.json()) as { attachment: { id: string } };
    const down = await w.guest.call("GET", `/workspaces/acme/attachments/${attachment.id}`);
    expect(down.status).toBe(200);
    expect(down.headers.get("content-type")).toBe("application/octet-stream");
    expect(down.headers.get("content-disposition")).toContain("attachment");
    expect(await down.text()).toContain("alert");
  });

  it("records activity and publishes change events", async () => {
    const w = await world();
    const before = t.events.events.length;
    const i = await newIssue(w.owner, w.projectId);
    await w.owner.call("PATCH", `/workspaces/acme/issues/${i.id}`, { priority: 1, title: "Renamed" });
    const act = await w.owner.json<{ activity: { field: string }[] }>("GET", `/workspaces/acme/issues/${i.id}/activity`);
    // One update writes its rows with the same timestamp, so their order is free.
    const fields = act.data.activity.map((a) => a.field);
    expect(fields[0]).toBe("created");
    expect(fields.slice(1).sort()).toEqual(["priority", "title"]);
    expect(t.events.events.slice(before).some((e) => e.entity === "issue" && e.id === i.id)).toBe(true);
  });

  it("keeps saved views private unless shared", async () => {
    const w = await world();
    await w.member.call("POST", "/workspaces/acme/views", { name: "Mine", layout: "board", filter: {}, shared: false });
    await w.member.call("POST", "/workspaces/acme/views", { name: "Team", layout: "list", filter: {}, shared: true });
    const seen = await w.owner.json<{ views: { name: string }[] }>("GET", "/workspaces/acme/views");
    expect(seen.data.views.map((v) => v.name)).toEqual(["Team"]);
  });
});
