import { describe, it, expect } from "vitest";
import { simulateSequentialMerge, applyDeepVerdicts, deepCandidates, type DeepResults } from "../mergeSim";
import { buildDependencyGraph } from "../buildDependencyGraph";
import { file, pr, replaceLine } from "../__fixtures__/prs";

const base = ["import x", "function a() {", "  return 1;", "}", "", "function b() {", "  return 2;", "}"].join("\n");
const edit = (from: string, to: string) => base.replace(from, to);

describe("simulateSequentialMerge (diff3)", () => {
  it("reports clean when the PRs edit different functions", () => {
    const out = simulateSequentialMerge({
      mergeBaseA: base,
      headA: edit("return 1;", "return 10;"),
      mergeBaseB: base,
      headB: edit("return 2;", "return 20;"),
      baseTip: base,
    });
    expect(out).toEqual({ status: "clean" });
  });

  it("reports the conflicting base lines when both edit the same line", () => {
    const out = simulateSequentialMerge({
      mergeBaseA: base,
      headA: edit("return 1;", "return 10;"),
      mergeBaseB: base,
      headB: edit("return 1;", "return 11;"),
      baseTip: base,
    });
    expect(out.status).toBe("conflict");
    if (out.status === "conflict") {
      expect(out.regions[0]).toMatchObject({ baseStart: 3, baseEnd: 3 });
      expect(out.regions[0].aPreview).toContain("+  return 10;");
      expect(out.regions[0].bPreview).toContain("+  return 11;");
    }
  });

  it("replays A onto a drifted base tip before checking B (different merge bases)", () => {
    // base moved: a header line was inserted at the top after B branched off.
    const tip = "// header\n" + base;
    const out = simulateSequentialMerge({
      mergeBaseA: tip,
      headA: tip.replace("return 2;", "return 22;"),
      mergeBaseB: base,
      headB: edit("return 1;", "return 11;"),
      baseTip: tip,
    });
    expect(out).toEqual({ status: "clean" }); // line numbers shifted, but the edits are disjoint
  });

  it("returns unknown when A itself conflicts with the base tip", () => {
    const tip = edit("return 1;", "return 100;");
    const out = simulateSequentialMerge({
      mergeBaseA: base,
      headA: edit("return 1;", "return 10;"),
      mergeBaseB: base,
      headB: base,
      baseTip: tip,
    });
    expect(out.status).toBe("unknown");
  });

  it("treats an absent file (null) as empty — add/add of different content conflicts", () => {
    const out = simulateSequentialMerge({ mergeBaseA: null, headA: "a", mergeBaseB: null, headB: "b", baseTip: null });
    expect(out.status).toBe("conflict");
  });
});

describe("applyDeepVerdicts", () => {
  const drifted = () =>
    buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(3, "x"))], { baseSha: "s1" }),
      pr(2, 2, [file("a.ts", replaceLine(3, "y"))], { baseSha: "s2" }),
    ]);

  it("selects approximate edges as deep candidates", () => {
    expect(deepCandidates(drifted(), 20).map((e) => e.id)).toEqual(["1-2"]);
    expect(deepCandidates(drifted(), 0)).toHaveLength(0);
  });

  it("a verified clean merge demotes approx BLOCKS to an exact TOUCHES and unblocks", () => {
    const g = drifted();
    expect(g.edges[0]).toMatchObject({ type: "BLOCKS", certainty: "approx" });
    const results: DeepResults = new Map([["1-2", new Map([["a.ts", { status: "clean" as const }]])]]);
    const v = applyDeepVerdicts(g, results);
    expect(v.edges[0]).toMatchObject({ type: "TOUCHES", blocking: false, certainty: "exact", evidence: "diff3" });
    expect(v.nodes.find((n) => n.id === "2")!.data.status).toBe("AT_RISK");
  });

  it("a verified conflict makes the edge exact with diff3 regions", () => {
    const g = drifted();
    const regions = [{ baseStart: 3, baseEnd: 3, aPreview: ["+x"], bPreview: ["+y"] }];
    const v = applyDeepVerdicts(g, new Map([["1-2", new Map([["a.ts", { status: "conflict" as const, regions }]])]]));
    expect(v.edges[0]).toMatchObject({ type: "BLOCKS", blocking: true, certainty: "exact", evidence: "diff3" });
    expect(v.edges[0].conflicts![0]).toMatchObject({ method: "diff3", regions });
  });

  it("is a no-op without results", () => {
    const g = drifted();
    expect(applyDeepVerdicts(g, new Map())).toBe(g);
  });
});
