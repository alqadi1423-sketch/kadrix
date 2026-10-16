import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PASSWORD, newUser } from "./helpers";

function totp(secret: string) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("turning on two-step sign-in, then signing in with a code", async ({ browser }) => {
  const { page, email } = await newUser(browser, "en-US", "Sara");
  await page.request.post("/api/workspaces", { data: { name: "Acme", slug: `s${Date.now().toString(36)}` }, headers: { origin: new URL(page.url()).origin } });
  await page.goto("/");
  await page.locator("a[href^='/w/']").first().click();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Your preferences" }).or(page.getByRole("tab", { name: "Your preferences" })).first().click();
  await page.getByLabel("Your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Turn on" }).click();
  const secret = (await page.locator("code").first().innerText()).trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("On", { exact: true })).toBeVisible();

  await Promise.all([page.waitForURL((u) => u.pathname === "/"), page.getByRole("button", { name: "Sign out" }).click()]);
  await page.waitForLoadState("networkidle");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("heading", { name: "Two-step sign-in" })).toBeVisible();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("input[name=code]")).toHaveCount(0);
});
