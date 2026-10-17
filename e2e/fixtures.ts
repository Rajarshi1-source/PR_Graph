import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared fixture: every page fails the test on uncaught page errors or console errors
 * (hydration mismatches, Base UI misuse, React warnings surfaced as errors).
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        // Socket reconnect noise is expected on pages without a session; ignore network 401s.
        if (/Failed to load resource: the server responded with a status of 401/.test(text)) return;
        errors.push(text);
      });
      await use(errors);
      expect(errors, "console / page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Open the demo and wait until React Flow has rendered every node. */
export async function openDemo(page: Page) {
  await page.goto("/demo");
  await expect(page.locator(".react-flow__node")).toHaveCount(15);
}

/** A PR node by number (nodes are role=button with an aria-label starting "PR #<n>:"). */
export const prNode = (page: Page, n: number) => page.getByRole("button", { name: new RegExp(`^PR #${n}:`) });
