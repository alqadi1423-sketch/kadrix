import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp } from "./test-utils.js";

const t = setupTestApp();
beforeAll(() => t.migrate());
afterAll(() => t.close());
beforeEach(() => t.reset());

async function world() {
  const owner = await t.signUp("Owner");
  await owner.call("POST", "/workspaces", { name: "Acme", slug: "acme" });
  const guest = await t.signUp("Client");
  await owner.call("POST", "/workspaces/acme/members", { email: guest.email, role: "guest" });
  const mk = async (key: string) => (await owner.json<{ project: { id: string } }>("POST", "/workspaces/acme/projects", { name: key, key })).data.project.id;
  const shared = await mk("SHR");
  const secret = await mk("SEC");
  const issue = async (projectId: string, title: string) =>
    (await owner.json<{ issue: { id: string; key: string } }>("POST", "/workspaces/acme/issues", { projectId, title })).data.issue;
  const a = await issue(shared, "Shared work");
  const b = await issue(secret, "Secret work");
  await owner.call("PUT", `/workspaces/acme/members/${guest.id}/projects`, { projectIds: [shared] });
  return { owner, guest, shared, secret, a, b };
}

describe("guest access", () => {
  it("sees only granted projects and their issues", async () => {
    const w = await world();
    const projects = await w.guest.json<{ projects: { id: string }[] }>("GET", "/workspaces/acme/projects");
    expect(projects.data.projects.map((p) => p.id)).toEqual([w.shared]);
    const list = await w.guest.json<{ issues: { title: string }[] }>("GET", `/workspaces/acme/issues?filter=${encodeURIComponent('{"search":"work"}')}`);
    expect(list.data.issues.map((i) => i.title)).toEqual(["Shared work"]);
  });

  it("gets 404 for everything in other projects, even with ids", async () => {
    const w = await world();
    const paths = [
      `/workspaces/acme/projects/${w.secret}`,
      `/workspaces/acme/issues/${w.b.id}`,
      `/workspaces/acme/issues/key/${w.b.key}`,
      `/workspaces/acme/issues/${w.b.id}/comments`,
      `/workspaces/acme/issues/${w.b.id}/activity`,
      `/workspaces/acme/issues/${w.b.id}/links`,
      `/workspaces/acme/projects/${w.secret}/cycles`,
      `/workspaces/acme/projects/${w.secret}/timeline`,
    ];
    for (const p of paths) expect((await w.guest.call("GET", p)).status, p).toBe(404);
    expect((await w.guest.call("POST", `/workspaces/acme/issues/${w.b.id}/comments`, { body: "hi" })).status).toBe(404);
    expect((await w.guest.call("POST", `/workspaces/acme/issues/${w.a.id}/comments`, { body: "hi" })).status).toBe(201);
  });

  it("sees nothing until granted, and only admins can grant", async () => {
    const owner = await t.signUp("Owner");
    await owner.call("POST", "/workspaces", { name: "Acme", slug: "acme" });
    const guest = await t.signUp("Client");
    const member = await t.signUp("Member");
    await owner.call("POST", "/workspaces/acme/members", { email: guest.email, role: "guest" });
    await owner.call("POST", "/workspaces/acme/members", { email: member.email, role: "member" });
    const pid = (await owner.json<{ project: { id: string } }>("POST", "/workspaces/acme/projects", { name: "P", key: "PP" })).data.project.id;
    const none = await guest.json<{ projects: unknown[] }>("GET", "/workspaces/acme/projects");
    expect(none.data.projects).toHaveLength(0);
    expect((await member.call("PUT", `/workspaces/acme/members/${guest.id}/projects`, { projectIds: [pid] })).status).toBe(403);
    // Only guests have a project list; members see everything.
    expect((await owner.call("PUT", `/workspaces/acme/members/${member.id}/projects`, { projectIds: [pid] })).status).toBe(400);
    const members = await owner.json<{ members: { email: string; projectIds: string[] | null }[] }>("GET", "/workspaces/acme/members");
    expect(members.data.members.find((x) => x.email === guest.email)?.projectIds).toEqual([]);
    expect(members.data.members.find((x) => x.email === member.email)?.projectIds).toBeNull();
  });
});
