import { test, expect } from "./fixtures";

test.describe("auth gating + API contract", () => {
  test("protected pages redirect anonymous users to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/repo/acme/storefront/history");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("protected API returns a 401 ProblemDetail", async ({ request }) => {
    for (const path of ["/api/repos", "/api/overview", "/api/repos/1/merge-plan", "/api/repos/1/settings"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/problem+json");
      expect(await res.json()).toMatchObject({ status: 401, title: "Unauthorized" });
    }
  });

  test("health endpoint responds", async ({ request }) => {
    const res = await request.get("/api/health");
    // 503 is a valid answer when Postgres/Redis are down; the endpoint itself must respond.
    expect([200, 503]).toContain(res.status());
  });
});
