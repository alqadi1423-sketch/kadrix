import { expect, test } from "@playwright/test";
import { newUser, seed, uid } from "./helpers";

test("two people edit one page at the same time, and issue keys link both ways", async ({ browser }) => {
  const a = await newUser(browser, "ar-SA", "محمد");
  const b = await newUser(browser, "en-US", "Sara");
  const slug = `w${uid()}`;
  const { post, projectId } = await seed(a.page, { slug, projectKey: "WEB", projectName: "Web" });
  await post(`/workspaces/${slug}/members`, { email: b.email, role: "member" });
  await post(`/workspaces/${slug}/issues`, { projectId, title: "Login page" });
  const { page: doc } = await post(`/workspaces/${slug}/pages`, { title: "خطة الإطلاق", projectId });

  await a.page.goto(`/w/${slug}/docs/${doc.id}`);
  await b.page.goto(`/w/${slug}/docs/${doc.id}`);
  const editorA = a.page.locator(".ProseMirror");
  const editorB = b.page.locator(".ProseMirror");
  await expect(editorA).toBeVisible();
  await expect(editorB).toBeVisible();

  await editorA.click();
  await a.page.keyboard.type("نبدأ بإصلاح WEB-1 قبل الإطلاق");
  await expect(editorB).toContainText("نبدأ بإصلاح WEB-1", { timeout: 10_000 });

  await editorB.click();
  await b.page.keyboard.press("End");
  await b.page.keyboard.press("Enter");
  await b.page.keyboard.type("English line");
  await expect(editorA).toContainText("English line", { timeout: 10_000 });

  // Each block picks its own direction.
  const dirOf = (text: string) => editorA.locator("p", { hasText: text }).first().evaluate((p) => getComputedStyle(p).direction);
  expect(await dirOf("نبدأ بإصلاح")).toBe("rtl");
  expect(await dirOf("English line")).toBe("ltr");

  // The page is stored and the issue it mentions knows about it.
  await expect
    .poll(async () => {
      const r = await a.page.request.get(`/api/workspaces/${slug}/pages/${doc.id}`);
      return ((await r.json()).issues ?? []).map((i: { key: string }) => i.key);
    }, { timeout: 15_000 })
    .toEqual(["WEB-1"]);
  await a.page.goto(`/w/${slug}/i/WEB-1`);
  await expect(a.page.getByRole("link", { name: "خطة الإطلاق" })).toBeVisible();
});
