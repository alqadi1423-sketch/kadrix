import { notification, page, userPreference } from "@veloq/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ydocToText } from "./collab.js";
import { syncPageIssues } from "./routes/pages.js";
import { chatBody, chatText } from "./services/chat-format.js";
import { sendDigests, type Mail } from "./services/digest.js";
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
  const pid = (await owner.json<{ project: { id: string } }>("POST", "/workspaces/acme/projects", { name: "Web", key: "WEB" })).data.project.id;
  await owner.call("PUT", `/workspaces/acme/members/${guest.id}/projects`, { projectIds: [pid] });
  const ws = (await owner.json<{ workspace: { id: string } }>("GET", "/workspaces/acme")).data.workspace as unknown as { workspaceId: string };
  return { owner, guest, pid, workspaceId: ws.workspaceId };
}

describe("pages", () => {
  it("creates nested pages and refuses loops", async () => {
    const w = await world();
    const a = (await w.owner.json<{ page: { id: string } }>("POST", "/workspaces/acme/pages", { title: "Specs", projectId: w.pid })).data.page;
    const b = (await w.owner.json<{ page: { id: string } }>("POST", "/workspaces/acme/pages", { title: "API", projectId: w.pid, parentId: a.id })).data.page;
    expect((await w.owner.call("PATCH", `/workspaces/acme/pages/${a.id}`, { parentId: b.id })).status).toBe(400);
    // Parent must be in the same project.
    expect((await w.owner.call("POST", "/workspaces/acme/pages", { title: "X", parentId: a.id })).status).toBe(400);
    const list = await w.owner.json<{ pages: { title: string }[] }>("GET", `/workspaces/acme/pages?projectId=${w.pid}`);
    expect(list.data.pages.map((p) => p.title).sort()).toEqual(["API", "Specs"]);
  });

  it("shows guests project pages of their projects only, read-only", async () => {
    const w = await world();
    await w.owner.call("POST", "/workspaces/acme/pages", { title: "Handbook" });
    const proj = (await w.owner.json<{ page: { id: string } }>("POST", "/workspaces/acme/pages", { title: "Client brief", projectId: w.pid })).data.page;
    const seen = await w.guest.json<{ pages: { title: string }[] }>("GET", "/workspaces/acme/pages");
    expect(seen.data.pages.map((p) => p.title)).toEqual(["Client brief"]);
    expect((await w.guest.call("POST", "/workspaces/acme/pages", { title: "x", projectId: w.pid })).status).toBe(403);
    expect((await w.guest.call("PATCH", `/workspaces/acme/pages/${proj.id}`, { title: "x" })).status).toBe(403);
  });

  it("extracts text from the collaborative document and links mentioned issues", async () => {
    const w = await world();
    const i = (await w.owner.json<{ issue: { id: string } }>("POST", "/workspaces/acme/issues", { projectId: w.pid, title: "Login" })).data.issue;
    const pg = (await w.owner.json<{ page: { id: string } }>("POST", "/workspaces/acme/pages", { title: "Plan", projectId: w.pid })).data.page;
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("default");
    const p1 = new Y.XmlElement("paragraph");
    p1.insert(0, [new Y.XmlText("خطة صفحة الدخول <مهم> & عاجل")]);
    const p2 = new Y.XmlElement("paragraph");
    p2.insert(0, [new Y.XmlText("Tracked in WEB-1")]);
    frag.insert(0, [p1, p2]);
    const text = ydocToText(doc);
    expect(text).toBe("خطة صفحة الدخول <مهم> & عاجل\nTracked in WEB-1");
    await t.db.update(page).set({ contentText: text }).where(eq(page.id, pg.id));
    await syncPageIssues(t.db, w.workspaceId, pg.id, text);
    const mentioned = await w.owner.json<{ pages: { title: string }[] }>("GET", `/workspaces/acme/issues/${i.id}/pages`);
    expect(mentioned.data.pages.map((p) => p.title)).toEqual(["Plan"]);
    const search = await w.owner.json<{ pages: { title: string }[] }>("GET", `/workspaces/acme/pages?q=${encodeURIComponent("الدخول")}`);
    expect(search.data.pages.map((p) => p.title)).toEqual(["Plan"]);
  });
});

describe("chat messages", () => {
  const payload = { event: "issue.created", data: { issue: { key: "WEB-3", title: "Fix login", stateName: "Todo" } } };
  it("formats Slack and Discord bodies with a link, in Arabic or English", () => {
    const en = chatText(payload, "en", "https://veloq.example", "acme");
    expect(en).toBe("New issue WEB-3: Fix login\nhttps://veloq.example/w/acme/i/WEB-3");
    expect(chatText(payload, "ar", "https://x", "acme").startsWith("مهمة جديدة WEB-3")).toBe(true);
    expect(chatBody("slack", "hi")).toEqual({ text: "hi" });
    expect(chatBody("discord", "hi")).toEqual({ content: "hi" });
  });
});

describe("email digest", () => {
  it("sends one email a day in the user's language and respects opt-out", async () => {
    const w = await world();
    const member = await t.signUp("Member");
    await w.owner.call("POST", "/workspaces/acme/members", { email: member.email, role: "member" });
    await w.owner.call("POST", "/workspaces/acme/issues", { projectId: w.pid, title: "Payments", assigneeId: member.id });
    await member.call("PATCH", "/me/preferences", { locale: "ar" });
    // Make the notification old enough to be included.
    await t.db.execute(sql`update notification set created_at = now() - interval '2 hours'`);
    const mails: Mail[] = [];
    const send = async (m: Mail) => void mails.push(m);
    expect(await sendDigests(t.db, send, "https://veloq.example")).toBe(1);
    expect(mails[0]!.to).toBe(member.email);
    expect(mails[0]!.subject).toContain("إشعارات");
    expect(mails[0]!.html).toContain('dir="rtl"');
    expect(mails[0]!.text).toContain("https://veloq.example/w/acme/i/WEB-1");
    // Not again within a day.
    expect(await sendDigests(t.db, send, "https://veloq.example")).toBe(0);
    // Opted out: never.
    await t.db.update(userPreference).set({ lastDigestAt: new Date(Date.now() - 2 * 864e5), emailDigest: false });
    expect(await sendDigests(t.db, send, "https://veloq.example")).toBe(0);
    // Read notifications are not sent.
    await t.db.update(userPreference).set({ emailDigest: true });
    await t.db.update(notification).set({ readAt: new Date() });
    expect(await sendDigests(t.db, send, "https://veloq.example")).toBe(0);
  });
});
