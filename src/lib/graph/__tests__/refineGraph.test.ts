import { describe, it, expect } from "vitest";
import { buildDependencyGraph } from "../buildDependencyGraph";
import { refineGraph } from "../refineGraph";
import type { PRWithFiles } from "../types";
import type { ConflictVerdict } from "@/lib/ai/types";

const pr = (number: number, createdAt: string, files: string[]): PRWithFiles => ({
  number,
  title: `PR ${number}`,
  author: "a",
  createdAt,
  htmlUrl: `https://github.com/o/r/pull/${number}`,
  files: files.map((f) => ({ filename: f, additions: 1, deletions: 0 })),
});

const verdict = (v: ConflictVerdict["verdict"]): ConflictVerdict => ({
  verdict: v,
  confidence: 0.9,
  explanation: `${v} (test)`,
});

describe("refineGraph", () => {
  it("annotates edges with the semantic verdict and explanation", () => {
    const g = buildDependencyGraph([pr(1, "2026-01-01", ["a.ts"]), pr(2, "2026-01-02", ["a.ts"])]);
    const edgeId = g.edges[0].id;
    const refined = refineGraph(g, new Map([[edgeId, verdict("TRUE_CONFLICT")]]));
    const e = refined.edges[0];
    expect(e.semanticVerdict).toBe("TRUE_CONFLICT");
    expect(e.explanation).toContain("TRUE_CONFLICT");
  });

  it("does not mutate the input graph (pure)", () => {
    const g = buildDependencyGraph([pr(1, "2026-01-01", ["a.ts"]), pr(2, "2026-01-02", ["a.ts"])]);
    const snapshot = JSON.stringify(g);
    refineGraph(g, new Map([[g.edges[0].id, verdict("CO_LOCATED")]]));
    expect(JSON.stringify(g)).toEqual(snapshot);
  });

  it("CO_LOCATED demotion flips a BLOCKED node back to SAFE", () => {
    const g = buildDependencyGraph([pr(1, "2026-01-01", ["a.ts"]), pr(2, "2026-01-02", ["a.ts"])]);
    expect(g.nodes.find((n) => n.id === "2")!.data.status).toBe("BLOCKED");

    const refined = refineGraph(g, new Map([[g.edges[0].id, verdict("CO_LOCATED")]]));
    const n2 = refined.nodes.find((n) => n.id === "2")!;
    expect(refined.edges[0].type).toBe("CO_LOCATED");
    expect(n2.data.status).toBe("SAFE");
    expect(n2.data.blockedBy).toHaveLength(0);
    expect(refined.stats.safePRs).toBe(2);
    expect(refined.stats.blockedPRs).toBe(0);
  });

  it("keeps a TRUE_CONFLICT edge blocking (status unchanged)", () => {
    const g = buildDependencyGraph([pr(1, "2026-01-01", ["a.ts"]), pr(2, "2026-01-02", ["a.ts"])]);
    const refined = refineGraph(g, new Map([[g.edges[0].id, verdict("TRUE_CONFLICT")]]));
    expect(refined.nodes.find((n) => n.id === "2")!.data.status).toBe("BLOCKED");
  });

  it("demotion breaks a deadlock cycle and unblocks both PRs", () => {
    // Two PRs sharing two files but crossing in time → a 2-cycle (deadlock).
    const a: PRWithFiles = {
      number: 1,
      title: "PR 1",
      author: "a",
      createdAt: "2026-01-01",
      htmlUrl: "",
      files: [
        { filename: "x.ts", additions: 1, deletions: 0 },
        { filename: "y.ts", additions: 1, deletions: 0 },
      ],
    };
    const b: PRWithFiles = {
      number: 2,
      title: "PR 2",
      author: "b",
      createdAt: "2026-01-02",
      htmlUrl: "",
      files: [
        { filename: "x.ts", additions: 1, deletions: 0 },
        { filename: "y.ts", additions: 1, deletions: 0 },
      ],
    };
    const g = buildDependencyGraph([a, b]);
    // Single aggregated edge here (no cycle), but demoting it must remove the only blocker.
    const refined = refineGraph(g, new Map(g.edges.map((e) => [e.id, verdict("CO_LOCATED")])));
    expect(refined.cycles.flat()).toHaveLength(0);
    expect(refined.stats.deadlockedPRs).toBe(0);
    expect(refined.stats.safePRs).toBe(2);
    expect(refined.mergeOrder.levels[0].sort()).toEqual(["1", "2"]);
  });

  it("leaves edges without a verdict untouched", () => {
    const g = buildDependencyGraph([pr(1, "2026-01-01", ["a.ts"]), pr(2, "2026-01-02", ["a.ts"])]);
    const refined = refineGraph(g, new Map());
    expect(refined.edges[0].semanticVerdict).toBeUndefined();
    expect(refined.nodes.find((n) => n.id === "2")!.data.status).toBe("BLOCKED");
  });
});
