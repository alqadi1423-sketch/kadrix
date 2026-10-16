import { addDays, formatDate } from "@veloq/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runRecurrences } from "./services/recurrence.js";
import { setupTestApp } from "./test-utils.js";

const github: { pages: unknown[][]; calls: string[] } = { pages: [], calls: [] };
const t = setupTestApp({
  importFetch: async (url: string | URL | Request) => {
    github.calls.push(String(url));
    const page = Number(new URL(String(url)).searchParams.get("page"));
    return new Response(JSON.stringify(github.pages[page - 1] ?? []), { status: 200 });
  },
});
beforeAll(() => t.migrate());
afterAll(() => t.close());
beforeEach(() => t.reset());

type State = { id: string; category: string; name: string };
type Issue = { id: string; key: string; stateId: string; priority: number; labelIds: string[]; assigneeId: string | null; title: string; parentId: string | null };

async function world() {
  const owner = await t.signUp("Owner");
  await owner.call("POST", "/workspaces", { name: "Acme", slug: "acme" });
  const member = await t.signUp("Member");
  const guest = await t.signUp("Guest");
  await owner.call("POST", "/workspaces/acme/members", { email: member.email, role: "member" });
  await owner.call("POST", "/workspaces/acme/members", { email: guest.email, role: "guest" });
  const pid = (await owner.json<{ project: { id: string } }>("POST", "/workspaces/acme/projects", { name: "Web", key: "WEB" })).data.project.id;
  const states = (await owner.json<{ states: State[] }>("GET", `/workspaces/acme/projects/${pid}`)).data.states;
  const state = (c: string) => states.find((s) => s.category === c)!.id;
  const newIssue = async (extra: Record<string, unknown> = {}, who = owner) =>
    (await who.json<{ issue: Issue }>("POST", "/workspaces/acme/issues", { projectId: pid, title: "x", ...extra })).data.issue;
  const get = async (id: string) => (await owner.json<{ issue: Issue }>("GET", `/workspaces/acme/issues/${id}`)).data.issue;
  return { owner, member, guest, pid, states, state, newIssue, get };
}

describe("custom fields", () => {
  it("validates values by kind, records history and scopes by project", async () => {
    const w = await world();
    const size = (
      await w.owner.json<{ field: { id: string } }>("POST", "/workspaces/acme/fields", {
        name: "الحجم",
        kind: "select",
        options: [
          { id: "s", name: "صغير" },
          { id: "l", name: "كبير" },
        ],
      })
    ).data.field;
    const points = (await w.owner.json<{ field: { id: string } }>("POST", "/workspaces/acme/fields", { name: "Points", kind: "number" })).data.field;
    expect((await w.member.call("POST", "/workspaces/acme/fields", { name: "No", kind: "text" })).status).toBe(403);

    const i = await w.newIssue({ fields: { [size.id]: "s" } });
    expect((await w.owner.call("PATCH", `/workspaces/acme/issues/${i.id}`, { fields: { [size.id]: "zzz" } })).status).toBe(400);
    expect((await w.owner.call("PATCH", `/workspaces/acme/issues/${i.id}`, { fields: { [points.id]: 5, [size.id]: "l" } })).status).toBe(200);
    const vals = await w.owner.json<{ values: Record<string, unknown> }>("GET", `/workspaces/acme/issues/${i.id}/fields`);
    expect(vals.data.values).toEqual({ [size.id]: "l", [points.id]: 5 });
    const act = await w.owner.json<{ activity: { field: string }[] }>("GET", `/workspaces/acme/issues/${i.id}/activity`);
    expect(act.data.activity.map((a) => a.field)).toEqual(expect.arrayContaining([`field:${size.id}`, `field:${points.id}`]));
    // Clearing a value removes it.
    await w.owner.call("PATCH", `/workspaces/acme/issues/${i.id}`, { fields: { [points.id]: null } });
    expect((await w.owner.json<{ values: Record<string, unknown> }>("GET", `/workspaces/acme/issues/${i.id}/fields`)).data.values).toEqual({ [size.id]: "l" });

    // A field from another project cannot be set.
    const other = (await w.owner.json<{ project: { id: string } }>("POST", "/workspaces/acme/projects", { name: "App", key: "APP" })).data.project.id;
    const appOnly = (await w.owner.json<{ field: { id: string } }>("POST", "/workspaces/acme/fields", { name: "OS", kind: "text", projectId: other })).data.field;
    expect((await w.owner.call("PATCH", `/workspaces/acme/issues/${i.id}`, { fields: { [appOnly.id]: "ios" } })).status).toBe(400);
  });
});

describe("automation", () => {
  it("runs matching rules after a change, as the automation source", async () => {
    const w = await world();
    const lbl = (await w.owner.json<{ label: { id: string } }>("POST", "/workspaces/acme/labels", { name: "needs-qa", color: "#123456" })).data.label;
    const rule = await w.owner.json<{ rule: { id: string } }>("POST", "/workspaces/acme/automations", {
      name: "QA when done",
      projectId: w.pid,
      trigger: "stateChanged",
      conditions: [{ field: "stateCategory", op: "is", value: "completed" }],
      actions: [
        { kind: "addLabel", labelId: lbl.id },
        { kind: "comment", body: "تمت الإضافة للاختبار" },
      ],
    });
    expect(rule.status).toBe(201);
    const i = await w.newIssue();
    await w.member.call("PATCH", `/workspaces/acme/issues/${i.id}`, { stateId: w.state("started") });
    expect((await w.get(i.id)).labelIds).toEqual([]);
    await w.member.call("PATCH", `/workspaces/acme/issues/${i.id}`, { stateId: w.state("completed") });
    expect((await w.get(i.id)).labelIds).toEqual([lbl.id]);
    const comments = await w.owner.json<{ comments: { body: string; authorId: string | null; source: string | null }[] }>("GET", `/workspaces/acme/issues/${i.id}/comments`);
    expect(comments.data.comments).toEqual([expect.objectContaining({ body: "تمت الإضافة للاختبار", authorId: null, source: "automation" })]);
    const rules = await w.owner.json<{ rules: { runCount: number; lastError: string | null }[] }>("GET", "/workspaces/acme/automations");
    expect(rules.data.rules[0]).toMatchObject({ runCount: 1, lastError: null });
  });

  it("stops rule chains that would loop forever", async () => {
    const w = await world();
    await w.owner.call("POST", "/workspaces/acme/automations", { name: "up", trigger: "priorityChanged", conditions: [{ field: "priority", op: "is", value: 2 }], actions: [{ kind: "setPriority", priority: 3 }] });
    await w.owner.call("POST", "/workspaces/acme/automations", { name: "down", trigger: "priorityChanged", conditions: [{ field: "priority", op: "is", value: 3 }], actions: [{ kind: "setPriority", priority: 2 }] });
    const i = await w.newIssue();
    const r = await w.owner.call("PATCH", `/workspaces/acme/issues/${i.id}`, { priority: 2 });
    expect(r.status).toBe(200);
    expect([2, 3]).toContain((await w.get(i.id)).priority);
  });

  it("refuses rules that point outside the workspace or set a state without a project", async () => {
    const w = await world();
    const bad = await w.owner.call("POST", "/workspaces/acme/automations", { name: "x", trigger: "issueCreated", actions: [{ kind: "setState", stateId: w.state("started") }] });
    expect(bad.status).toBe(400);
    const stranger = await w.owner.call("POST", "/workspaces/acme/automations", { name: "x", trigger: "issueCreated", actions: [{ kind: "assign", userId: "nobody" }] });
    expect(stranger.status).toBe(400);
    expect((await w.member.call("POST", "/workspaces/acme/automations", { name: "x", trigger: "issueCreated", actions: [{ kind: "setPriority", priority: 1 }] })).status).toBe(403);
  });

  it("assigns new bugs automatically", async () => {
    const w = await world();
    await w.owner.call("POST", "/workspaces/acme/automations", {
      name: "Bugs to Member",
      trigger: "issueCreated",
      conditions: [{ field: "type", op: "is", value: "bug" }],
      actions: [{ kind: "assign", userId: w.member.id }],
    });
    const bug = await w.newIssue({ type: "bug" });
    const task = await w.newIssue();
    expect((await w.get(bug.id)).assigneeId).toBe(w.member.id);
    expect((await w.get(task.id)).assigneeId).toBeNull();
  });
});

describe("templates and recurring issues", () => {
  it("creates issues from a template on schedule, once per missed run", async () => {
    const w = await world();
    const tpl = (
      await w.owner.json<{ template: { id: string } }>("POST", "/workspaces/acme/templates", { projectId: w.pid, name: "Weekly review", title: "مراجعة أسبوعية", priority: 3 })
    ).data.template;
    const today = formatDate(new Date());
    const r = await w.owner.json<{ recurrence: { nextDate: string } }>("POST", "/workspaces/acme/recurrences", { templateId: tpl.id, freq: "daily", startDate: today });
    expect(r.data.recurrence.nextDate).toBe(today);
    expect(await runRecurrences(t.db, t.events, today)).toBe(1);
    expect(await runRecurrences(t.db, t.events, today)).toBe(0);
    // Three days later: one issue for the latest missed day, not three.
    expect(await runRecurrences(t.db, t.events, addDays(today, 3))).toBe(1);
    const list = await w.owner.json<{ issues: Issue[] }>("GET", "/workspaces/acme/issues");
    expect(list.data.issues.map((i) => [i.title, i.priority])).toEqual([
      ["مراجعة أسبوعية", 3],
      ["مراجعة أسبوعية", 3],
    ]);
    expect((await w.guest.call("POST", "/workspaces/acme/templates", { projectId: w.pid, name: "x" })).status).toBe(403);
  });
});

describe("time tracking", () => {
  it("logs time and only lets people remove their own entries", async () => {
    const w = await world();
    const i = await w.newIssue();
    const today = formatDate(new Date());
    const e = (await w.member.json<{ entry: { id: string } }>("POST", `/workspaces/acme/issues/${i.id}/time`, { minutes: 90, date: today })).data.entry;
    await w.owner.call("POST", `/workspaces/acme/issues/${i.id}/time`, { minutes: 30, date: today, note: "مراجعة" });
    const list = await w.owner.json<{ totalMinutes: number }>("GET", `/workspaces/acme/issues/${i.id}/time`);
    expect(list.data.totalMinutes).toBe(120);
    expect((await w.guest.call("POST", `/workspaces/acme/issues/${i.id}/time`, { minutes: 5, date: today })).status).toBe(403);
    const ownerEntry = (await w.owner.json<{ entries: { id: string; userId: string }[] }>("GET", `/workspaces/acme/issues/${i.id}/time`)).data.entries.find((x) => x.userId === w.owner.id)!;
    expect((await w.member.call("DELETE", `/workspaces/acme/time/${ownerEntry.id}`)).status).toBe(403);
    expect((await w.member.call("DELETE", `/workspaces/acme/time/${e.id}`)).status).toBe(200);
  });
});

describe("reports", () => {
  it("measures flow and workload", async () => {
    const w = await world();
    const a = await w.newIssue({ assigneeId: w.member.id, estimate: 3 });
    await w.newIssue({ assigneeId: w.member.id, estimate: 2 });
    await w.owner.call("PATCH", `/workspaces/acme/issues/${a.id}`, { stateId: w.state("started") });
    await w.owner.call("PATCH", `/workspaces/acme/issues/${a.id}`, { stateId: w.state("completed") });
    const r = await w.owner.json<{
      flow: { completed: number; leadP50: number };
      workload: { userId: string; open: number; estimate: number }[];
      cfd: Record<string, number>[];
      throughput: { done: number }[];
    }>("GET", `/workspaces/acme/reports?projectId=${w.pid}`);
    expect(r.status).toBe(200);
    expect(r.data.flow.completed).toBe(1);
    expect(r.data.workload).toEqual([expect.objectContaining({ userId: w.member.id, open: 1, estimate: 2 })]);
    const last = r.data.cfd.at(-1)!;
    expect(last.completed).toBe(1);
    expect(last.triage! + last.backlog! + last.unstarted!).toBe(1);
    expect(r.data.throughput.at(-1)!.done).toBe(1);
    // Guests do not see reports.
    expect((await w.guest.call("GET", "/workspaces/acme/reports")).status).toBe(403);
  });
});

describe("import", () => {
  const jira = [
    "Summary,Issue key,Issue Type,Status,Priority,Labels,Assignee,Parent",
    "صفحة الدخول,OLD-1,Story,Done,High,auth,member@example.com,",
    "Fix redirect,OLD-2,Bug,In Progress,Low,auth,,OLD-1",
  ].join("\n");

  it("imports a Jira export once and updates on re-import", async () => {
    const w = await world();
    const first = await w.owner.json<{ stats: { created: number; labels: number } }>("POST", "/workspaces/acme/import", { source: "jira", projectId: w.pid, csv: jira });
    expect(first.data.stats).toMatchObject({ created: 2, labels: 1 });
    const issues = (await w.owner.json<{ issues: Issue[] }>("GET", `/workspaces/acme/issues?filter=${encodeURIComponent(JSON.stringify({ includeClosed: true }))}`)).data.issues;
    const login = issues.find((i) => i.title === "صفحة الدخول")!;
    const fix = issues.find((i) => i.title === "Fix redirect")!;
    expect(login.assigneeId).toBe(w.member.id);
    expect(login.stateId).toBe(w.state("completed"));
    expect(fix.parentId).toBe(login.id);

    const again = await w.owner.json<{ stats: { created: number; updated: number } }>("POST", "/workspaces/acme/import", {
      source: "jira",
      projectId: w.pid,
      csv: jira.replace("Fix redirect", "Fix the redirect"),
    });
    expect(again.data.stats).toMatchObject({ created: 0, updated: 2 });
    expect((await w.get(fix.id)).title).toBe("Fix the redirect");
    expect((await w.member.call("POST", "/workspaces/acme/import", { source: "jira", projectId: w.pid, csv: jira })).status).toBe(403);
  });

  it("imports GitHub issues page by page, without pull requests", async () => {
    const w = await world();
    github.pages = [
      [
        ...Array.from({ length: 99 }, (_, n) => ({ number: n + 1, title: `Issue ${n + 1}`, state: "open" })),
        { number: 100, title: "A PR", state: "open", pull_request: {} },
      ],
      [{ number: 101, title: "Last", state: "closed", state_reason: "completed", labels: [{ name: "bug" }] }],
    ];
    github.calls = [];
    const r = await w.owner.json<{ stats: { created: number } }>("POST", "/workspaces/acme/import", { source: "github", projectId: w.pid, repo: "acme/web" });
    expect(r.data.stats.created).toBe(100);
    expect(github.calls).toHaveLength(2);
    expect(github.calls[0]).toContain("https://api.github.com/repos/acme/web/issues?state=all");
  });
});

describe("Arabic search", () => {
  it("matches across letter variants and the attached article", async () => {
    const w = await world();
    await w.newIssue({ title: "تحسين إدارة المشروع", description: "نقل الملفات للمستودع الجديد" });
    const search = async (q: string) =>
      (await w.owner.json<{ issues: Issue[] }>("GET", `/workspaces/acme/issues?filter=${encodeURIComponent(JSON.stringify({ search: q }))}`)).data.issues.length;
    expect(await search("ادارة")).toBe(1);
    expect(await search("مشروع")).toBe(1);
    expect(await search("مستودع")).toBe(1);
    expect(await search("تحسي")).toBe(1);
    expect(await search("برمجة")).toBe(0);
  });
});
