import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ApiError } from "./errors.js";
import { rateLimit } from "./ratelimit.js";

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
