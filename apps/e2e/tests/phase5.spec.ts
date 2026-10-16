import { expect, test } from "@playwright/test";
import { newUser, seed, uid } from "./helpers";

test("time in Arabic digits, custom fields and the reports page", async ({ browser }) => {
  const { page } = await newUser(browser, "ar-SA", "محمد");
  const slug = `w${uid()}`;
  const { post, projectId } = await seed(page, { slug, projectKey: "WEB", projectName: "الموقع" });
  await post(`/workspaces/${slug}/fields`, { name: "البيئة", kind: "select", options: [{ id: "prod", name: "الإنتاج" }] });
  await post(`/workspaces/${slug}/issues`, { projectId, title: "إصلاح صفحة الدخول" });

  await page.goto(`/w/${slug}/i/WEB-1`);
  await page.getByLabel("المدة").fill("١س ٣٠د");
  await page.getByRole("button", { name: "تسجيل وقت" }).click();
  await expect(page.getByText("1س 30د").first()).toBeVisible();

  await page.getByRole("combobox", { name: "البيئة" }).selectOption("prod");
  await expect(page.getByText("غيّر محمد الحقل البيئة")).toBeVisible();

  await page.goto(`/w/${slug}/reports`);
  await expect(page.getByRole("heading", { name: "التقارير" })).toBeVisible();
  await expect(page.getByText("الوقت المسجل")).toBeVisible();
  await expect(page.getByText("1س 30د")).toBeVisible();
});
