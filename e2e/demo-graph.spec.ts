import { test, expect, openDemo, prNode } from "./fixtures";

test.describe("demo graph", () => {
  test("renders every PR with the right statuses and stats", async ({ page }) => {
    await openDemo(page);
    await expect(prNode(page, 101)).toHaveAccessibleName(/Status: Safe to merge/);
    await expect(prNode(page, 108)).toHaveAccessibleName(/Status: Has dependencies/);
    await expect(prNode(page, 102)).toHaveAccessibleName(/Status: Blocked/);
    await expect(prNode(page, 111)).toHaveAccessibleName(/Status: Deadlocked/);
    await expect(page.getByText("15 PRs")).toBeVisible();
    // INDIRECT edges are hidden until toggled
    const before = await page.locator(".react-flow__edge").count();
    await page.getByRole("button", { name: "Indirect" }).click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(before + 1);
  });

  test("clicking a PR opens the panel with line-level conflict evidence", async ({ page }) => {
    await openDemo(page);
    await prNode(page, 102).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Add refresh-token rotation")).toBeVisible();
    await expect(panel.getByText("Blocked by")).toBeVisible();
    await expect(panel.getByText("src/auth/session.ts").first()).toBeVisible();
    await expect(panel.getByText(/Base lines? 42/).first()).toBeVisible();
    await expect(panel.getByText("Review required")).toBeVisible();
    await expect(panel.getByRole("link", { name: /Open on GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/storefront/pull/102",
    );
  });

  test("keyboard: Enter on a focused node opens the panel", async ({ page }) => {
    await openDemo(page);
    await prNode(page, 104).focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Profile page: show last login")).toBeVisible();
    // the cross-file symbol link from #103
    await expect(panel.getByText(/renames/).first()).toBeVisible();
    await expect(panel.getByText("loadUser").first()).toBeVisible();
  });

  test("edge labels explain the dependency in a tooltip", async ({ page }) => {
    await openDemo(page);
    const label = page.getByRole("button", { name: /Dependency #103 to #104: uses loadUser/ });
    await label.hover();
    await expect(page.getByText(/Changes a symbol the other PR uses/).first()).toBeVisible();
  });

  test("merge plan lists steps, parked PRs and the critical path", async ({ page }) => {
    await openDemo(page);
    const plan = page.getByRole("region", { name: "Merge plan" });
    await expect(plan.getByText("Merge now")).toBeVisible();
    await expect(plan.getByText(/Parked \(\d+\)/)).toBeVisible();
    await expect(plan.getByText("CI failing: e2e")).toBeVisible();
    await expect(plan.getByText(/Critical path: #101 → #102 → #104/)).toBeVisible();
    await plan.getByRole("button", { name: "Levels" }).click();
    await expect(plan.getByText("Deadlocked")).toBeVisible();
  });

  test("simulating a merge shows which PRs would unblock", async ({ page }) => {
    await openDemo(page);
    await prNode(page, 101).click();
    await page.getByRole("button", { name: "Simulate merging this PR" }).click();
    await page.keyboard.press("Escape");
    const status = page.getByRole("status").filter({ hasText: "Simulating merge" });
    await expect(status).toContainText("#101");
    await expect(status).toContainText("#102");
    await expect(prNode(page, 101)).toHaveAccessibleName(/Simulated as merged/);
    await status.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText(/Simulating merge/)).toHaveCount(0);
  });

  test("workspace filter dims PRs outside the workspace", async ({ page }) => {
    await openDemo(page);
    await page.getByLabel("Filter by workspace").selectOption("packages/ui");
    await expect(page.locator(".react-flow__node .opacity-25")).not.toHaveCount(0);
    await expect(prNode(page, 107)).not.toHaveClass(/opacity-25/);
  });

  test("export menu downloads a PNG and JSON", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: "Export graph" }).click();
    const png = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "PNG image" }).click();
    expect((await png).suggestedFilename()).toBe("prgraph-acme-storefront.png");

    await page.getByRole("button", { name: "Export graph" }).click();
    const json = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download JSON" }).click();
    expect((await json).suggestedFilename()).toBe("prgraph-acme-storefront.json");
  });
});
