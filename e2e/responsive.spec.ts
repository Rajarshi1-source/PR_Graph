import { test, expect } from "./fixtures";

test.describe("phone width (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const path of ["/", "/demo", "/login"]) {
    test(`no horizontal page scroll on ${path}`, async ({ page }) => {
      await page.goto(path);
      if (path === "/demo") await expect(page.locator(".react-flow__node")).toHaveCount(15);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
