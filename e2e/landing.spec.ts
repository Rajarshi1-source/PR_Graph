import { test, expect } from "./fixtures";

test.describe("landing page", () => {
  test("shows the pitch, CTAs and status legend", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("collide");
    await expect(page.getByRole("link", { name: /Connect GitHub/ })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: /Try the live demo/ })).toHaveAttribute("href", "/demo");
    for (const label of ["Safe to merge", "Has dependencies", "Blocked", "Deadlocked (cycle)"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: /merge queues and AI reviewers/ })).toBeVisible();
  });

  test("theme toggle switches dark mode on <html>", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: "Toggle dark mode" });
    const wasDark = ((await html.getAttribute("class")) ?? "").includes("dark");
    await toggle.click();
    await expect(html).toHaveClass(wasDark ? /^(?!.*\bdark\b).*$/ : /\bdark\b/);
  });

  test("demo link navigates to the demo graph", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Try the live demo/ }).click();
    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.locator(".react-flow__node")).toHaveCount(15);
  });
});
