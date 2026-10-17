import { describe, it, expect } from "vitest";
import { buildDependencyGraph } from "../buildDependencyGraph";
import { refineGraph, canDemote, analyzableEdges, type RefineVerdict } from "../refineGraph";
import { file, pr, replaceLine, hunk, insertBefore } from "../__fixtures__/prs";

const verdict = (v: RefineVerdict["verdict"], extra: Partial<RefineVerdict> = {}): RefineVerdict => ({
  verdict: v,
  confidence: 0.9,
  explanation: `${v} (test)`,
  source: "ai",
  ...extra,
});

// approx BLOCKS: no patches (binary / huge files)
const approxPair = () => buildDependencyGraph([pr(1, 1, [file("a.bin")]), pr(2, 2, [file("a.bin")])]);
// exact BLOCKS: overlapping lines
const exactPair = () =>
  buildDependencyGraph([pr(1, 1, [file("a.ts", replaceLine(4, "x"))]), pr(2, 2, [file("a.ts", replaceLine(4, "y"))])]);

describe("refineGraph", () => {
  it("annotates edges with verdict, confidence, explanation, resolution and origin", () => {
    const g = exactPair();
    const refined = refineGraph(g, new Map([[g.edges[0].id, verdict("TRUE_CONFLICT", { resolution: "merge #1 first" })]]));
    expect(refined.edges[0]).toMatchObject({
      semanticVerdict: "TRUE_CONFLICT",
      confidence: 0.9,
      resolution: "merge #1 first",
      verdictOrigin: "ai",
    });
  });

  it("does not mutate the input graph (pure)", () => {
    const g = approxPair();
    const snapshot = JSON.stringify(g);
    refineGraph(g, new Map([[g.edges[0].id, verdict("CO_LOCATED")]]));
    expect(JSON.stringify(g)).toEqual(snapshot);
  });

  it("CO_LOCATED demotes APPROXIMATE evidence and flips BLOCKED → SAFE", () => {
    const g = approxPair();
    expect(g.nodes.find((n) => n.id === "2")!.data.status).toBe("BLOCKED");
    const refined = refineGraph(g, new Map([[g.edges[0].id, verdict("CO_LOCATED")]]));
    expect(refined.edges[0]).toMatchObject({ type: "CO_LOCATED", blocking: false });
    // a demoted edge is still a (soft) dependency → AT_RISK, no longer BLOCKED
    expect(refined.nodes.find((n) => n.id === "2")!.data.status).toBe("AT_RISK");
    expect(refined.stats.blockedPRs).toBe(0);
    expect(refined.mergeOrder.levels[0].sort()).toEqual(["1", "2"]);
  });

  it("never demotes an EXACT textual conflict (it is a fact)", () => {
    const g = exactPair();
    expect(canDemote(g.edges[0])).toBe(false);
    const refined = refineGraph(g, new Map([[g.edges[0].id, verdict("CO_LOCATED")]]));
    expect(refined.edges[0]).toMatchObject({ type: "BLOCKS", blocking: true, semanticVerdict: "CO_LOCATED" });
    expect(refined.nodes.find((n) => n.id === "2")!.data.status).toBe("BLOCKED");
  });

  it("never adds a blocking edge: TRUE_CONFLICT on TOUCHES stays non-blocking (AT_RISK)", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(4, "x"))]),
      pr(2, 2, [file("a.ts", insertBefore(90, "y"))]),
    ]);
    const refined = refineGraph(g, new Map([[g.edges[0].id, verdict("TRUE_CONFLICT")]]));
    expect(refined.edges[0]).toMatchObject({ type: "TOUCHES", blocking: false, semanticVerdict: "TRUE_CONFLICT" });
    expect(refined.nodes.find((n) => n.id === "2")!.data.status).toBe("AT_RISK");
  });

  it("can demote a regex-based SEMANTIC edge (approximate) and break a deadlock", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("a.ts", hunk(1, ["-export function alpha() {", "+export function alphaV2() {"])), file("c.ts", insertBefore(5, "beta();"))]),
      pr(2, 2, [file("b.ts", hunk(1, ["-export function beta() {", "+export function betaV2() {"])), file("d.ts", insertBefore(5, "alpha();"))]),
    ]);
    expect(g.stats.deadlockedPRs).toBe(2);
    const back = g.edges.find((e) => e.source === "2" && e.target === "1")!;
    const refined = refineGraph(g, new Map([[back.id, verdict("CO_LOCATED")]]));
    expect(refined.cycles).toHaveLength(0);
    expect(refined.stats.deadlockedPRs).toBe(0);
  });

  it("leaves edges without a verdict untouched", () => {
    const g = approxPair();
    const refined = refineGraph(g, new Map());
    expect(refined.edges[0].semanticVerdict).toBeUndefined();
    expect(refined.nodes.find((n) => n.id === "2")!.data.status).toBe("BLOCKED");
  });

  it("analyzableEdges skips STACKED and INDIRECT edges", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(1, "x"))], { headRef: "p", baseRef: "main" }),
      pr(2, 2, [file("b.ts", replaceLine(1, "y"))], { headRef: "c", baseRef: "p" }),
    ]);
    expect(g.edges.map((e) => e.type)).toEqual(["STACKED"]);
    expect(analyzableEdges(g)).toHaveLength(0);
  });
});
