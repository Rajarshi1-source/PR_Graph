import { describe, it, expect } from "vitest";
import { preflight, candidatePR } from "../preflight";
import { file, pr, replaceLine, hunk, insertBefore } from "../__fixtures__/prs";

const open = [
  pr(42, 1, [file("src/auth.ts", replaceLine(40, "return verify(t, opts);"))]),
  pr(57, 2, [file("src/user.ts", hunk(10, ["-export function getUser(id: string) {", "+export function fetchUser(id: string) {"]))]),
  pr(63, 3, [file("src/billing.ts", insertBefore(5, "charge();"))]),
  pr(70, 4, [file("src/auth.ts", insertBefore(300, "// far away"))]),
];

describe("preflight", () => {
  it("no interaction → risk none", () => {
    const r = preflight(open, { patch: "### docs/README.md\n" + replaceLine(1, "hello") });
    expect(r).toMatchObject({ risk: "none", collisions: [], waitFor: [] });
  });

  it("overlapping lines with an open PR → high risk, wait for it", () => {
    const r = preflight(open, { patch: "diff --git a/src/auth.ts b/src/auth.ts\n" + replaceLine(41, "return verify(t) ?? null;") });
    expect(r.risk).toBe("high");
    expect(r.waitFor).toEqual([42]);
    expect(r.collisions[0]).toMatchObject({ kind: "BLOCKS", direction: "wait", blocking: true, files: ["src/auth.ts"] });
    expect(r.collisions[0].regions[0]).toMatchObject({ file: "src/auth.ts", baseStart: 40 });
    // #70 only touches the same file far away → reported as non-blocking
    expect(r.collisions.find((c) => c.pr.number === 70)).toMatchObject({ kind: "TOUCHES", blocking: false });
    expect(r.recommendation).toContain("Wait for #42");
  });

  it("using a symbol another open PR renames → SEMANTIC, wait", () => {
    const r = preflight(open, { patch: "### src/profile.ts\n" + insertBefore(12, "const u = getUser(id);") });
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0]).toMatchObject({ kind: "SEMANTIC", direction: "wait", pr: { number: 57 } });
    expect(r.collisions[0].symbols[0]).toMatchObject({ name: "getUser", change: "renamed" });
  });

  it("renaming a symbol an open PR uses → affects that PR", () => {
    const r = preflight(open, { patch: "### src/pay.ts\n" + hunk(1, ["-export function charge() {", "+export function chargeCard() {"]) });
    expect(r.collisions[0]).toMatchObject({ kind: "SEMANTIC", direction: "affects", pr: { number: 63 } });
    expect(r.risk).toBe("high");
    expect(r.waitFor).toEqual([]);
    expect(r.recommendation).toContain("#63");
  });

  it("accepts a file list with line ranges (no diff available)", () => {
    const r = preflight(open, { files: [{ path: "src/auth.ts", ranges: [[39, 41]] }] });
    expect(r.waitFor).toEqual([42]);
    const noRanges = preflight(open, { files: [{ path: "src/auth.ts" }] });
    expect(noRanges.collisions.every((c) => c.blocking)).toBe(true); // unknown lines → conservative
  });

  it("passes statuses through and sorts blocking collisions first", () => {
    const r = preflight(open, { patch: "### src/auth.ts\n" + replaceLine(40, "x") }, { statusOf: (n) => (n === 42 ? "SAFE" : "AT_RISK") });
    expect(r.collisions.map((c) => c.pr.number)).toEqual([42, 70]);
    expect(r.collisions[0].pr.status).toBe("SAFE");
  });

  it("candidatePR builds a newest virtual PR #0", () => {
    const c = candidatePR({ files: [{ path: "a.ts", ranges: [[3, 4]] }] });
    expect(c.number).toBe(0);
    expect(c.files[0].patch).toContain("@@ -3,2 +3,2 @@");
  });
});
