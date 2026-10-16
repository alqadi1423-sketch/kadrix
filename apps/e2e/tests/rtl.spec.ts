import { expect, test } from "@playwright/test";
import { newUser, seed, uid } from "./helpers";

test("Arabic is right-to-left from the first screen, English flips it", async ({ browser }) => {
  const { page } = await newUser(browser, "ar-SA", "محمد");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");

  const slug = `w${uid()}`;
  const { projectId } = await seed(page, { slug, projectKey: "WEB", projectName: "الموقع" });
  await page.goto(`/w/${slug}/p/${projectId}`);

  // The sidebar sits on the right in Arabic.
  const nav = page.getByRole("navigation").first();
  const box = (await nav.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x + box.width).toBeGreaterThan(width * 0.6);

  // Create an issue with the keyboard shortcut.
  await page.keyboard.press("c");
  await page.fill("dialog[open] input[name=title]", "إصلاح صفحة الدخول");
  await page.locator("dialog[open] button[type=submit]").click();
  await page.waitForURL("**/i/WEB-1");
  await expect(page.getByText("إصلاح صفحة الدخول").first()).toBeVisible();

  // Switching language flips direction without a reload.
  await page.getByRole("combobox", { name: "اللغة" }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const after = (await page.getByRole("navigation").first().boundingBox())!;
  expect(after.x).toBeLessThan(width * 0.4);
});

test("mixed Arabic and English text keeps its own direction", async ({ browser }) => {
  const { page } = await newUser(browser, "en-US", "Sara");
  const slug = `w${uid()}`;
  const { post, projectId } = await seed(page, { slug, projectKey: "API", projectName: "API" });
  await post(`/workspaces/${slug}/issues`, { projectId, title: "تحسين سرعة API" });
  await page.goto(`/w/${slug}/i/API-1`);
  const title = page.getByText("تحسين سرعة API").first();
  await expect(title).toBeVisible();
  // dir="auto" resolves to rtl for text that starts in Arabic.
  expect(await title.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
});
