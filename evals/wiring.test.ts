import { describe, it, expect } from "vitest";
import { buildPrompt, buildUser } from "@/lib/ai/prompts/conflict.v3";
import { getPrompt, ACTIVE_PROMPT_VERSION, promptVersions } from "@/lib/ai/prompts/registry";
import { verdictKey } from "@/lib/ai/cache";
import type { ConflictInput } from "@/lib/ai/types";

const input: ConflictInput = {
  prA: 11,
  prB: 22,
  sharedFiles: ["src/a.ts", "src/b.ts"],
  diffA: "@@ -1,2 +1,3 @@ DIFF_A_MARKER_ALPHA",
  diffB: "@@ -1,2 +1,3 @@ DIFF_B_MARKER_BETA",
};

describe("conflict prompt wiring", () => {
  it("injects both diffs into the rendered user prompt", () => {
    const user = buildUser(input);
    expect(user).toContain("DIFF_A_MARKER_ALPHA");
    expect(user).toContain("DIFF_B_MARKER_BETA");
    expect(user).toContain("#11");
    expect(user).toContain("#22");
  });

  it("leaves no unfilled template placeholders", () => {
    const { system, user } = buildPrompt(input);
    expect(user).not.toMatch(/\{\{.*?\}\}/);
    expect(system ?? "").not.toMatch(/\{\{.*?\}\}/);
  });

  it("registry resolves the active version to a system+user prompt", () => {
    const tmpl = getPrompt();
    expect(tmpl.version).toBe(ACTIVE_PROMPT_VERSION);
    const p = tmpl.buildPrompt(input);
    expect(p.system).toBeTruthy();
    expect(p.user).toContain("DIFF_A_MARKER_ALPHA");
  });

  it("cache key is content-addressed and order-insensitive over shared files", () => {
    const k1 = verdictKey(ACTIVE_PROMPT_VERSION, input);
    const k2 = verdictKey(ACTIVE_PROMPT_VERSION, {
      ...input,
      sharedFiles: ["src/b.ts", "src/a.ts"],
    });
    expect(k1).toBe(k2); // sorted internally
    expect(k1.startsWith(`ai:verdict:${ACTIVE_PROMPT_VERSION}:`)).toBe(true);
    expect(k1).toMatch(/:[0-9a-f]{64}$/); // full sha256

    const k3 = verdictKey(ACTIVE_PROMPT_VERSION, { ...input, diffA: "different" });
    expect(k3).not.toBe(k1);

    const k4 = verdictKey(ACTIVE_PROMPT_VERSION, { ...input, focus: "src/a.ts lines 1-2" });
    expect(k4).not.toBe(k1); // engine focus notes are part of the content address
  });

  it("v4 renders the engine focus notes and asks for a resolution", () => {
    const tmpl = getPrompt("conflict.v4");
    const p = tmpl.buildPrompt({ ...input, focus: "FOCUS_MARKER overlap in src/a.ts" });
    expect(p.user).toContain("FOCUS_MARKER");
    expect(p.system).toContain("resolution");
  });

  it("keeps v3 registered for side-by-side evaluation", () => {
    expect(promptVersions()).toEqual(expect.arrayContaining(["conflict.v3", "conflict.v4"]));
    expect(getPrompt("conflict.v3").version).toBe("conflict.v3");
  });
});
