import { test, openDemo, prNode } from "./fixtures";

/**
 * README screenshots (`npm run screenshots`). Tagged @screenshots and excluded from CI.
 * Writes docs/images/*.png.
 */
test.describe("@screenshots", () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  const shot = (name: string) => ({ path: `docs/images/${name}.png`, animations: "disabled" as const });

  test("landing", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.screenshot(shot("landing"));
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`graph-${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openDemo(page);
      await page.waitForTimeout(600); // fitView animation
      await page.screenshot(shot(`graph-${scheme}`));
    });
  }

  test("pr-panel", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDemo(page);
    await prNode(page, 102).click();
    await page.getByRole("dialog").getByText("Blocked by").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot(shot("pr-panel"));
  });

  test("what-if", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDemo(page);
    await prNode(page, 101).click();
    await page.getByRole("button", { name: "Simulate merging this PR" }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.screenshot(shot("what-if"));
  });

  test("preflight", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openDemo(page);
    await page.getByRole("button", { name: "Preflight" }).click();
    await page.getByRole("button", { name: "Call loadUser() somewhere new" }).click();
    await page.getByRole("button", { name: "Check for collisions" }).click();
    await page.getByRole("status", { name: "Preflight result" }).waitFor();
    await page.screenshot(shot("preflight"));
  });
});
