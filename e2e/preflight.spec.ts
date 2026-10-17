import { test, expect, openDemo } from "./fixtures";

test.describe("agent preflight", () => {
  test("playground reports a blocking collision for an overlapping edit", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: "Preflight" }).click();
    await page.getByRole("button", { name: "Edit session validation" }).click();
    await page.getByRole("button", { name: "Check for collisions" }).click();
    const result = page.getByRole("status", { name: "Preflight result" });
    await expect(result).toContainText("Risk: high");
    await expect(result).toContainText("#101");
    await expect(result).toContainText("Wait for");
  });

  test("playground reports a cross-file symbol collision", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: "Preflight" }).click();
    await page.getByRole("button", { name: "Call loadUser() somewhere new" }).click();
    await page.getByRole("button", { name: "Check for collisions" }).click();
    const result = page.getByRole("status", { name: "Preflight result" });
    await expect(result).toContainText("#103");
    await expect(result).toContainText("semantic");
  });

  test("demo API: clean change → risk none; invalid body → 422 ProblemDetail", async ({ request }) => {
    const ok = await request.post("/api/demo/preflight", {
      data: { patch: "diff --git a/docs/x.md b/docs/x.md\n@@ -1,1 +1,1 @@\n-a\n+b" },
    });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).risk).toBe("none");

    const bad = await request.post("/api/demo/preflight", { data: { files: [] } });
    expect(bad.status()).toBe(422);
    expect(bad.headers()["content-type"]).toContain("application/problem+json");
  });

  test("token API rejects missing / malformed tokens with 401", async ({ request }) => {
    const res = await request.post("/api/v1/preflight", { data: { repo: "a/b", patch: "x" } });
    expect(res.status()).toBe(401);
    const bad = await request.post("/api/v1/preflight", {
      data: { repo: "a/b", patch: "x" },
      headers: { authorization: "Bearer not-a-token" },
    });
    expect(bad.status()).toBe(401);
  });
});
