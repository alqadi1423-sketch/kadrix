import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp } from "./test-utils.js";

const t = setupTestApp({ authAttemptsPer5Min: 3, trustProxy: 1 });
const { app } = t;

beforeAll(() => t.migrate());
afterAll(() => t.close());
beforeEach(() => t.reset());

const BASE = "http://localhost:3000";
const signUp = (email: string, password: string, ip = "198.51.100.7") =>
  app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip },
    body: JSON.stringify({ name: "Sara", email, password }),
  });

describe("password policy", () => {
  it("refuses short and guessable passwords", async () => {
    expect((await signUp("a@example.com", "short-pass")).status).toBe(400);
    const weak = await signUp("b@example.com", "passwordpassword1");
    expect(weak.status).toBe(400);
    expect(await weak.json()).toMatchObject({ code: "WEAK_PASSWORD" });
  });
  it("accepts a long passphrase", async () => {
    expect((await signUp("c@example.com", "قهوة الصباح مع المطر")).status).toBe(200);
  });
});

describe("credential rate limit", () => {
  it("slows repeated attempts from one address only", async () => {
    for (let i = 0; i < 3; i++) await signUp(`x${i}@example.com`, "nope");
    expect((await signUp("x9@example.com", "nope")).status).toBe(429);
    // A different client behind the same proxy keeps its own budget.
    expect((await signUp("y@example.com", "correct-horse-battery", "198.51.100.8")).status).toBe(200);
  });
});
