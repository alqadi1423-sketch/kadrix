import { expect, test } from "@playwright/test";
import { newUser, seed, uid } from "./helpers";

test("a teammate's board updates live when an issue moves", async ({ browser }) => {
  const a = await newUser(browser, "en-US", "Owner");
  const b = await newUser(browser, "en-US", "Member");
  const slug = `w${uid()}`;
  const { post, projectId } = await seed(a.page, { slug, projectKey: "OPS", projectName: "Ops" });
  await post(`/workspaces/${slug}/members`, { email: b.email, role: "member" });
  await post(`/workspaces/${slug}/issues`, { projectId, title: "Rotate keys" });

  await b.page.goto(`/w/${slug}/p/${projectId}`);
  await b.page.getByRole("tab", { name: "Board" }).click();
  const column = b.page.locator('section[aria-label="In progress"] article');
  await expect(column).toHaveCount(0);

  await a.page.goto(`/w/${slug}/i/OPS-1`);
  await a.page.selectOption('select[aria-label="Status"]', { label: "In progress" });
  await expect(column).toHaveCount(1, { timeout: 10_000 });
});
