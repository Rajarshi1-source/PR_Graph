import { describe, it, expect } from "vitest";
import { buildDemoGraph } from "../fixtures";

/** The demo is the E2E fixture — pin the shape it must keep exercising. */
describe("demo fixture graph", () => {
  const g = buildDemoGraph();
  const edge = (s: number, t: number) => g.edges.find((e) => e.source === String(s) && e.target === String(t));
  const status = (id: number) => g.nodes.find((n) => n.id === String(id))!.data.status;

  it("exercises every edge type", () => {
    expect(edge(101, 102)).toMatchObject({ type: "BLOCKS", certainty: "exact" });
    expect(edge(102, 104)).toMatchObject({ type: "BLOCKS" });
    expect(edge(101, 104)).toMatchObject({ type: "INDIRECT", via: ["102"] });
    expect(edge(103, 104)).toMatchObject({ type: "SEMANTIC" });
    expect(edge(105, 114)).toMatchObject({ type: "BLOCKS", certainty: "exact" });
    expect(edge(105, 106)).toMatchObject({ type: "TOUCHES" });
    expect(edge(107, 108)).toMatchObject({ type: "TOUCHES" });
    expect(edge(107, 115)).toMatchObject({ type: "BLOCKS", certainty: "approx" });
    expect(edge(109, 110)).toMatchObject({ type: "STACKED" });
    expect(edge(111, 112)?.type).toBe("SEMANTIC");
    expect(edge(112, 111)?.type).toBe("SEMANTIC");
  });

  it("exercises every status", () => {
    expect(status(101)).toBe("SAFE");
    expect(status(108)).toBe("AT_RISK");
    expect(status(102)).toBe("BLOCKED");
    expect(status(111)).toBe("DEADLOCKED");
    expect(status(112)).toBe("DEADLOCKED");
  });

  it("produces a merge plan with parked PRs and a critical path", () => {
    const plan = g.mergePlan!;
    expect(plan.steps[0].prs).toEqual(expect.arrayContaining(["101", "103", "105", "107"]));
    const parked = new Map(plan.parked.map((p) => [p.id, p]));
    expect(parked.get("109")!.reasons[0]).toMatch(/CI failing: e2e/);
    expect(parked.get("110")!.waitingOn).toEqual(["109"]);
    expect(parked.get("113")!.reasons).toContain("Draft PR");
    expect(parked.get("111")!.reasons[0]).toMatch(/Deadlocked/);
    expect(plan.criticalPath).toEqual(["101", "102", "104"]);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildDemoGraph())).toBe(JSON.stringify(g));
  });
});
