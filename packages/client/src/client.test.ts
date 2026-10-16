import { describe, expect, it } from "vitest";
import { KadrixError, createClient, liveUrl } from "./index.js";

describe("client", () => {
  it("sends the token and locale and unwraps results", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createClient({
      baseUrl: "https://kadrix.example.com/",
      token: "kdx_abc",
      locale: "ar",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ issues: [{ key: "WEB-1" }] }), { status: 200 });
      },
    });
    const issues = await client.issues("acme", { search: "دخول" });
    expect(issues[0]!.key).toBe("WEB-1");
    expect(calls[0]!.url).toContain("https://kadrix.example.com/api/workspaces/acme/issues?filter=");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer kdx_abc");
    expect(h["x-kadrix-locale"]).toBe("ar");
  });

  it("raises a typed error with the server's code", async () => {
    const client = createClient({ baseUrl: "http://x", fetch: async () => new Response(JSON.stringify({ error: "notFound" }), { status: 404 }) });
    await expect(client.issueByKey("acme", "WEB-9")).rejects.toEqual(new KadrixError(404, "notFound"));
  });

  it("builds the live updates address", () => {
    expect(liveUrl("https://kadrix.example.com", "acme")).toBe("wss://kadrix.example.com/api/workspaces/acme/live");
  });
});
