import { addDays, formatDate } from "@veloq/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp } from "./test-utils.js";

const t = setupTestApp();
beforeAll(() => t.migrate());
afterAll(() => t.close());
beforeEach(() => t.reset());

type State = { id: string; category: string };

async function world() {
  const owner = await t.signUp("Owner");
  await owner.call("POST", "/workspaces", { name: "Acme", slug: "acme" }, { "x-veloq-locale": "ar" });
  const guest = await t.signUp("Guest");
  await owner.call("POST", "/workspaces/acme/members", { email: guest.email, role: "guest" });
  const p = await owner.json<{ project: { id: string } }>("POST", "/workspaces/acme/projects", { name: "Core", key: "COR" });
  const pid = p.data.project.id;
  const states = (await owner.json<{ states: State[] }>("GET", `/workspaces/acme/projects/${pid}`)).data.states;
  const state = (c: string) => states.find((s) => s.category === c)!.id;
  const issue = async (extra: Record<string, unknown> = {}) =>
    (await owner.json<{ issue: { id: string } }>("POST", "/workspaces/acme/issues", { projectId: pid, title: "x", ...extra })).data.issue.id;
  return { owner, guest, pid, state, issue };
}

const today = formatDate(new Date());

describe("workspace calendar settings", () => {
  it("defaults the weekend from the creator's language and lets admins change it", async () => {
    const w = await world();
    const ws = await w.owner.json<{ workspace: { weekendDays: number[] } }>("GET", "/workspaces/acme");
    expect(ws.data.workspace.weekendDays).toEqual([5, 6]);
    await w.owner.call("PATCH", "/workspaces/acme", { weekendDays: [0, 6] });
    const after = await w.owner.json<{ workspace: { weekendDays: number[] } }>("GET", "/workspaces/acme");
    expect(after.data.workspace.weekendDays).toEqual([0, 6]);
  });
});

describe("cycles", () => {
  it("numbers cycles, rejects overlaps and blocks guests", async () => {
    const w = await world();
    const path = `/workspaces/acme/projects/${w.pid}/cycles`;
    const c1 = await w.owner.json<{ cycle: { number: number } }>("POST", path, { startsOn: today, endsOn: addDays(today, 13) });
    const c2 = await w.owner.json<{ cycle: { number: number } }>("POST", path, { startsOn: addDays(today, 14), endsOn: addDays(today, 27) });
    expect([c1.data.cycle.number, c2.data.cycle.number]).toEqual([1, 2]);
    expect((await w.owner.call("POST", path, { startsOn: addDays(today, 5), endsOn: addDays(today, 20) })).status).toBe(400);
    expect((await w.owner.call("POST", path, { startsOn: today, endsOn: addDays(today, -1) })).status).toBe(400);
    expect((await w.guest.call("POST", path, { startsOn: addDays(today, 40), endsOn: addDays(today, 41) })).status).toBe(403);
  });

  it("rolls unfinished work into the next cycle when completed", async () => {
    const w = await world();
    const path = `/workspaces/acme/projects/${w.pid}/cycles`;
    const c1 = (await w.owner.json<{ cycle: { id: string } }>("POST", path, { startsOn: addDays(today, -13), endsOn: today })).data.cycle;
    const c2 = (await w.owner.json<{ cycle: { id: string } }>("POST", path, { startsOn: addDays(today, 1), endsOn: addDays(today, 14) })).data.cycle;
    const done = await w.issue({ cycleId: c1.id, estimate: 3, stateId: w.state("completed") });
    const open = await w.issue({ cycleId: c1.id, estimate: 5 });
    const r = await w.owner.json<{ rolledOver: number; movedTo: string }>("POST", `/workspaces/acme/cycles/${c1.id}/complete`, {});
    expect(r.data).toEqual({ rolledOver: 1, movedTo: c2.id });
    const moved = await w.owner.json<{ issue: { cycleId: string } }>("GET", `/workspaces/acme/issues/${open}`);
    expect(moved.data.issue.cycleId).toBe(c2.id);
    const kept = await w.owner.json<{ issue: { cycleId: string } }>("GET", `/workspaces/acme/issues/${done}`);
    expect(kept.data.issue.cycleId).toBe(c1.id);
    const list = await w.owner.json<{ cycles: { id: string; status: string; donePoints: number }[]; velocity: number }>("GET", path);
    expect(list.data.cycles.find((c) => c.id === c1.id)).toMatchObject({ status: "completed", donePoints: 3 });
    expect(list.data.velocity).toBe(3);
    // A completed cycle cannot be completed again.
    expect((await w.owner.call("POST", `/workspaces/acme/cycles/${c1.id}/complete`, {})).status).toBe(400);
  });

  it("produces a burndown in points", async () => {
    const w = await world();
    const c1 = (
      await w.owner.json<{ cycle: { id: string } }>("POST", `/workspaces/acme/projects/${w.pid}/cycles`, {
        startsOn: addDays(today, -2),
        endsOn: addDays(today, 7),
      })
    ).data.cycle;
    const a = await w.issue({ cycleId: c1.id, estimate: 2 });
    await w.issue({ cycleId: c1.id, estimate: 3 });
    await w.owner.call("PATCH", `/workspaces/acme/issues/${a}`, { stateId: w.state("completed") });
    const b = await w.owner.json<{ unit: string; points: { date: string; remaining: number; scope: number }[] }>(
      "GET",
      `/workspaces/acme/cycles/${c1.id}/burndown`,
    );
    expect(b.data.unit).toBe("points");
    const last = b.data.points.at(-1)!;
    expect(last.date).toBe(today);
    expect(last).toMatchObject({ scope: 5, remaining: 3 });
  });
});

describe("milestones and timeline", () => {
  it("reports milestone progress", async () => {
    const w = await world();
    const ms = (
      await w.owner.json<{ milestone: { id: string } }>("POST", `/workspaces/acme/projects/${w.pid}/milestones`, {
        name: "Beta",
        targetDate: addDays(today, 30),
      })
    ).data.milestone;
    await w.issue({ milestoneId: ms.id, stateId: w.state("completed") });
    await w.issue({ milestoneId: ms.id });
    await w.issue({ milestoneId: ms.id, stateId: w.state("canceled") });
    const list = await w.owner.json<{ milestones: { total: number; done: number }[] }>("GET", `/workspaces/acme/projects/${w.pid}/milestones`);
    expect(list.data.milestones[0]).toMatchObject({ total: 2, done: 1 });
  });

  it("computes the critical path over blocking issues", async () => {
    const w = await world();
    const d = (n: number) => addDays("2026-11-01", n); // a Sunday
    const design = await w.issue({ title: "design", startDate: d(0), dueDate: d(2) });
    const api = await w.issue({ title: "api", startDate: d(3), dueDate: d(10) });
    const docs = await w.issue({ title: "docs", startDate: d(3), dueDate: d(3) });
    await w.issue({ title: "undated" });
    await w.owner.call("POST", `/workspaces/acme/issues/${design}/relations`, { type: "blocks", relatedIssueId: api });
    await w.owner.call("POST", `/workspaces/acme/issues/${design}/relations`, { type: "blocks", relatedIssueId: docs });
    const tl = await w.owner.json<{ issues: unknown[]; undated: number; criticalPath: string[]; dependencies: unknown[] }>(
      "GET",
      `/workspaces/acme/projects/${w.pid}/timeline`,
    );
    expect(tl.data.issues).toHaveLength(3);
    expect(tl.data.undated).toBe(1);
    expect(tl.data.dependencies).toHaveLength(2);
    expect(tl.data.criticalPath).toEqual([design, api]);
  });

  it("lists issues due in a date range for the calendar", async () => {
    const w = await world();
    await w.issue({ dueDate: "2026-11-05" });
    await w.issue({ dueDate: "2026-12-05" });
    const cal = await w.owner.json<{ issues: unknown[] }>("GET", "/workspaces/acme/calendar?from=2026-11-01&to=2026-11-30");
    expect(cal.data.issues).toHaveLength(1);
  });
});

describe("initiatives", () => {
  it("rolls up progress from linked projects and keeps health updates", async () => {
    const w = await world();
    await w.issue({ stateId: w.state("completed") });
    await w.issue();
    const ini = (
      await w.owner.json<{ initiative: { id: string } }>("POST", "/workspaces/acme/initiatives", {
        name: "Launch v1",
        projectIds: [w.pid],
      })
    ).data.initiative;
    await w.owner.call("POST", "/workspaces/acme/updates", { initiativeId: ini.id, health: "atRisk", body: "API is late" });
    const list = await w.owner.json<{ initiatives: { total: number; done: number; health: string }[] }>("GET", "/workspaces/acme/initiatives");
    expect(list.data.initiatives[0]).toMatchObject({ total: 2, done: 1, health: "atRisk" });
    const ups = await w.guest.json<{ updates: { body: string }[] }>("GET", `/workspaces/acme/updates?initiativeId=${ini.id}`);
    expect(ups.data.updates.map((u) => u.body)).toEqual(["API is late"]);
  });

  it("rejects projects from other workspaces", async () => {
    const w = await world();
    const other = await t.signUp("Other");
    await other.call("POST", "/workspaces", { name: "O", slug: "oth" });
    const op = await other.json<{ project: { id: string } }>("POST", "/workspaces/oth/projects", { name: "X", key: "XX" });
    const r = await w.owner.call("POST", "/workspaces/acme/initiatives", { name: "Bad", projectIds: [op.data.project.id] });
    expect(r.status).toBe(400);
  });
});
