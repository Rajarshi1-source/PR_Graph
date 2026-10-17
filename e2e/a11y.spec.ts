import AxeBuilder from "@axe-core/playwright";
import { test, expect, openDemo } from "./fixtures";

/** No serious or critical axe violations on the public pages. */
test.describe("accessibility", () => {
  for (const [path, scheme] of [
    ["/", "light"],
    ["/", "dark"],
    ["/demo", "light"],
    ["/demo", "dark"],
  ] as const) {
    test(`axe: ${path} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      if (path === "/demo") await openDemo(page);
      else await page.goto(path);
      const results = await new AxeBuilder({ page })
        // React Flow's own minimap / attribution are third-party decorations.
        .exclude(".react-flow__minimap")
        .analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`),
      ).toEqual([]);
    });
  }
});
