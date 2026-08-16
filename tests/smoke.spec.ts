import { test, expect } from "@playwright/test";

/**
 * 冒烟骨架(E20)。覆盖:首页可访问、/api/health 全绿、页头品牌回首页(E1)。
 * 后续每审一条关键路径,在此追加一条用例;改动后必跑。
 */

test("homepage loads and shows the audit input", async ({ page }) => {
  const res = await page.goto("/");
  expect(res, "no response").not.toBeNull();
  expect(res!.status(), "homepage HTTP").toBeLessThan(400);
  await expect(page).toHaveTitle(/AEOeye|AI/i);
  // 首页核心:审计输入框可见
  await expect(page.locator("input").first()).toBeVisible();
});

test("/api/health is green (200 + ok + db.ok)", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status(), "health HTTP").toBe(200);
  const body = await res.json();
  expect(body.status, "health status").toBe("ok");
  expect(body.database?.ok, "db connectivity").toBe(true);
});

test("header brand/logo returns to home (E1)", async ({ page }) => {
  await page.goto("/pricing");
  // 页头指向首页的链接(logo/品牌区)
  const homeLink = page.locator('header a[href="/"]').first();
  await expect(homeLink).toBeVisible();
  await homeLink.click();
  await expect(page).toHaveURL(/\/$|\/#/);
});
