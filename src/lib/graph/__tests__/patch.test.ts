import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { diff3Merge, diffPatch } from "node-diff3";
import { parsePatch, splitMultiFileDiff } from "../patch/parsePatch";
import { regionsConflict, conflictingRegions } from "../patch/regions";

describe("parsePatch", () => {
  it("maps a replacement to the deleted base lines", () => {
    const p = parsePatch("@@ -10,3 +10,3 @@ function f() {\n ctx\n-old\n+new\n ctx");
    expect(p.parseable).toBe(true);
    expect(p.hunks[0].context).toBe("function f() {");
    expect(p.regions).toEqual([{ start: 11, end: 11, removed: ["old"], added: ["new"] }]);
  });

  it("maps a pure insertion to a zero-width region before the next base line", () => {
    const p = parsePatch("@@ -4,2 +4,3 @@\n a\n+inserted\n b");
    expect(p.regions).toEqual([{ start: 5, end: 4, removed: [], added: ["inserted"] }]);
  });

  it("handles a zero-length old range (insertion after oldStart)", () => {
    const p = parsePatch("@@ -7,0 +8,2 @@\n+x\n+y");
    expect(p.regions[0]).toMatchObject({ start: 8, end: 7, added: ["x", "y"] });
  });

  it("collects regions across multiple hunks and ignores no-newline markers", () => {
    const p = parsePatch("@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file\n@@ -20,1 +20,0 @@\n-gone");
    expect(p.regions.map((r) => [r.start, r.end])).toEqual([
      [1, 1],
      [20, 20],
    ]);
  });

  it("reports unparseable input (binary / prose / empty)", () => {
    expect(parsePatch(undefined).parseable).toBe(false);
    expect(parsePatch("Binary files a/x.png and b/x.png differ").parseable).toBe(false);
  });
});

describe("regionsConflict (git's overlap-or-adjacent rule)", () => {
  let n = 0;
  const r = (start: number, end: number) => ({ start, end, removed: [], added: [`line ${n++}`] });
  it("conflicts on overlapping and adjacent edits", () => {
    expect(regionsConflict(r(10, 12), r(12, 14))).toBe(true);
    expect(regionsConflict(r(10, 10), r(11, 11))).toBe(true); // adjacent lines
    expect(regionsConflict(r(5, 4), r(5, 4))).toBe(true); // two insertions at the same point
    expect(regionsConflict(r(5, 4), r(5, 5))).toBe(true); // insertion touching an edit
  });
  it("treats identical edits on both sides as clean (like git)", () => {
    const same = { start: 3, end: 3, removed: ["x"], added: ["y"] };
    expect(regionsConflict(same, { ...same })).toBe(false);
  });
  it("does not conflict when an unchanged base line separates the edits", () => {
    expect(regionsConflict(r(10, 10), r(12, 12))).toBe(false);
    expect(regionsConflict(r(20, 19), r(21, 20))).toBe(false); // insertions around base line 20
    expect(regionsConflict(r(5, 4), r(6, 6))).toBe(false);
  });
  it("conflictingRegions returns sorted merged stretches with previews", () => {
    const a = parsePatch("@@ -3,1 +3,1 @@\n-x\n+A");
    const b = parsePatch("@@ -3,1 +3,1 @@\n-x\n+B");
    const out = conflictingRegions(a.regions, b.regions);
    expect(out).toEqual([{ baseStart: 3, baseEnd: 3, aPreview: ["-x", "+A"], bPreview: ["-x", "+B"] }]);
  });
});

describe("splitMultiFileDiff", () => {
  it("splits ### sections and diff --git headers", () => {
    const m = splitMultiFileDiff("### a.ts\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -2 +2 @@\n-c\n+d", "x");
    expect([...m.keys()]).toEqual(["a.ts", "b.ts"]);
    expect(m.get("b.ts")).toContain("-c");
  });
  it("attributes header-less text to the fallback file", () => {
    expect([...splitMultiFileDiff("@@ -1 +1 @@\n-a\n+b", "src/f.ts").keys()]).toEqual(["src/f.ts"]);
  });
});

/** Build a zero-context unified diff from node-diff3's patch (same LCS as diff3Merge). */
function unified(base: string[], edited: string[]): string {
  return diffPatch(base, edited)
    .map((h) => {
      const o = h.buffer1;
      const n = h.buffer2;
      const oldStart = o.length === 0 ? o.offset : o.offset + 1;
      const newStart = n.length === 0 ? n.offset : n.offset + 1;
      return [
        `@@ -${oldStart},${o.length} +${newStart},${n.length} @@`,
        ...o.chunk.map((l) => `-${l}`),
        ...n.chunk.map((l) => `+${l}`),
      ].join("\n");
    })
    .join("\n");
}

type Edit = { kind: "replace" | "delete" | "insert"; at: number; len: number };

function applyEdits(base: string[], edits: Edit[], tag: string): string[] {
  const out = [...base];
  // apply from the bottom so earlier indices stay valid
  [...edits]
    .sort((a, b) => b.at - a.at)
    .forEach((e, i) => {
      const at = Math.min(e.at, out.length);
      const fresh = Array.from({ length: e.len }, (_, k) => `${tag}${i}_${k}`);
      if (e.kind === "insert") out.splice(at, 0, ...fresh);
      else if (e.kind === "delete") out.splice(at, Math.max(1, e.len));
      else out.splice(at, Math.max(1, e.len), ...fresh);
    });
  return out;
}

describe("property: region analysis agrees with a real diff3 merge", () => {
  const edit = fc.record({
    kind: fc.constantFrom<Edit["kind"]>("replace", "delete", "insert"),
    at: fc.integer({ min: 0, max: 24 }),
    len: fc.integer({ min: 1, max: 3 }),
  });

  it("predicts a conflict exactly when diff3 reports one", () => {
    fc.assert(
      fc.property(fc.array(edit, { minLength: 1, maxLength: 2 }), fc.array(edit, { minLength: 1, maxLength: 2 }), (ea, eb) => {
        const base = Array.from({ length: 25 }, (_, i) => `L${i}`);
        const a = applyEdits(base, ea, "A");
        const b = applyEdits(base, eb, "B");
        const diff3Conflict = diff3Merge(a, base, b).some((r) => "conflict" in r);
        const predicted =
          conflictingRegions(parsePatch(unified(base, a)).regions, parsePatch(unified(base, b)).regions).length > 0;
        expect(predicted).toBe(diff3Conflict);
      }),
      { numRuns: 400, seed: 42 },
    );
  });
});
