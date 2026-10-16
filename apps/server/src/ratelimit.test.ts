import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ApiError } from "./errors.js";
import { clientIp, rateLimit } from "./ratelimit.js";

describe("rate limit", () => {
  it("returns 429 with Retry-After once the window is used up", async () => {
    const app = new Hono();
    app.onError((e, c) => (e instanceof ApiError ? c.json({ error: e.code }, e.status) : c.text("x", 500)));
    app.use("*", rateLimit(2, (c) => c.req.header("x-user") ?? null));
    app.get("/", (c) => c.text("ok"));
    const hit = (u: string) => app.request("/", { headers: { "x-user": u } });
    expect((await hit("a")).status).toBe(200);
    expect((await hit("a")).status).toBe(200);
    const third = await hit("a");
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    // Other callers have their own budget.
    expect((await hit("b")).status).toBe(200);
  });
});

describe("clientIp", () => {
  const ipApp = (hops: number) => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientIp(c, hops) ?? "none"));
    return app;
  };
  it("ignores X-Forwarded-For unless proxies are trusted", async () => {
    const res = await ipApp(0).request("/", { headers: { "x-forwarded-for": "6.6.6.6" } });
    expect(await res.text()).toBe("none");
  });
  it("reads the address the trusted proxy saw, not what the client claimed", async () => {
    const res = await ipApp(1).request("/", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } });
    expect(await res.text()).toBe("203.0.113.9");
  });
});
