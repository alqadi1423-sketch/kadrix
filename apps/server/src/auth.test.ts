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

import { createHmac } from "node:crypto";

function base32(s: string) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
function totp(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

describe("two-step sign-in", () => {
  it("asks for an authenticator code after the password once enabled", async () => {
    const email = "two@example.com";
    const password = "correct-horse-battery";
    const up = await signUp(email, password, "198.51.100.20");
    const cookie = up.headers.get("set-cookie")!.split(";")[0]!;
    const post = (path: string, body: unknown, c = cookie) =>
      app.request(`/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie: c, "x-forwarded-for": "198.51.100.20" }, body: JSON.stringify(body) });

    const enable = await post("/two-factor/enable", { password });
    expect(enable.status).toBe(200);
    const { totpURI, backupCodes } = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    expect(backupCodes.length).toBeGreaterThan(5);
    const secret = new URL(totpURI).searchParams.get("secret")!;
    expect((await post("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(200);

    const signIn = await post("/sign-in/email", { email, password }, "");
    expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
    const pending = signIn.headers.get("set-cookie")!.split(",").map((c) => c.split(";")[0]!.trim()).join("; ");
    expect((await post("/two-factor/verify-totp", { code: "000000" }, pending)).status).toBe(401);
    const ok = await post("/two-factor/verify-totp", { code: totp(secret) }, pending);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain("session_token");
  });
});
