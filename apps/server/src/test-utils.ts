import { createDb, runMigrations } from "@veloq/db";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { createMemoryEventBus } from "./events.js";
import { createMemoryStorage } from "./storage.js";

export const BASE = "http://localhost:3000";

/**
 * Builds an app against TEST_DATABASE_URL. Each test file gets its own
 * schema-sharing connection; `reset()` truncates all tenant data.
 */
export function setupTestApp() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for server tests");
  const { db, client } = createDb(url);
  const auth = createAuth(db, { secret: "test-secret-test-secret-test-secret!!", baseUrl: BASE });
  const events = createMemoryEventBus();
  const storage = createMemoryStorage();
  const app = createApp({
    db,
    auth,
    edition: "self-hosted",
    events,
    storage,
    baseUrl: BASE,
    githubWebhookSecret: "gh-test-secret",
  });

  async function signUp(name: string) {
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ name, email, password: "correct-horse-battery" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
    const call = (method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) =>
      app.request(`/api${path}`, {
        method,
        headers: { cookie, origin: BASE, ...(body ? { "content-type": "application/json" } : {}), ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined,
      });
    const json = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => {
      const r = await call(method, path, body);
      const data = (await r.json()) as T;
      return { status: r.status, data };
    };
    const { user } = (await (await call("GET", "/me")).json()) as { user: { id: string } };
    return { email, name, id: user.id, cookie, call, json };
  }

  return {
    app,
    db,
    events,
    storage,
    signUp,
    migrate: () => runMigrations(url),
    reset: () => db.execute(sql`TRUNCATE "user", workspace CASCADE`),
    close: () => client.end(),
  };
}

export type TestUser = Awaited<ReturnType<ReturnType<typeof setupTestApp>["signUp"]>>;
