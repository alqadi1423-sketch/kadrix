import { type Browser, type Page, expect } from "@playwright/test";

export const PASSWORD = "correct-horse-battery-staple";
let n = 0;
/** A unique suffix so tests never collide in a shared database. */
export const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function newUser(browser: Browser, locale: "ar-SA" | "en-US", name: string) {
  const ctx = await browser.newContext({ locale });
  const page = await ctx.newPage();
  const email = `${uid()}@example.com`;
  await page.goto("/");
  await page.locator("form ~ p button").click();
  await page.fill("input[name=name]", name);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.locator("form button[type=submit]").click();
  // Signed in once the account form is gone.
  await expect(page.locator("input[name=password]")).toHaveCount(0, { timeout: 15_000 });
  return { page, email, ctx };
}

/** Workspace + project through the API, using the page's session. */
export async function seed(page: Page, opts: { slug: string; projectKey: string; projectName: string; workspaceName?: string }) {
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post(`/api${path}`, { data, headers: { origin: new URL(page.url()).origin } });
    expect(r.ok(), `${path} ${r.status()} ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  await post("/workspaces", { name: opts.workspaceName ?? opts.slug, slug: opts.slug });
  const { project } = await post(`/workspaces/${opts.slug}/projects`, { name: opts.projectName, key: opts.projectKey });
  return { post, projectId: project.id as string };
}
