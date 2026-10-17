import { describe, it, expect } from "vitest";
import { toReadiness, type RawReadiness } from "../readiness";
import { planMerges, withMergePlan, planToMarkdown } from "../mergePlan";
import { whatIfMerge } from "../whatIf";
import { buildDependencyGraph } from "../buildDependencyGraph";
import type { Readiness } from "../types";
import { file, pr, replaceLine, hunk, insertBefore } from "../__fixtures__/prs";

const raw = (over: Partial<RawReadiness> = {}): RawReadiness => ({
  number: 1,
  isDraft: false,
  mergeable: "MERGEABLE",
  reviewDecision: "APPROVED",
  checks: [{ name: "ci", state: "success" }],
  ...over,
});

describe("toReadiness", () => {
  it("READY when green, approved, mergeable, not draft", () => {
    expect(toReadiness(raw())).toMatchObject({ state: "READY", ci: "success", review: "approved", score: 100, reasons: [] });
  });
  it("NOT_READY on failing CI / draft / changes requested / base conflict, with reasons", () => {
    const r = toReadiness(raw({ isDraft: true, checks: [{ name: "e2e", state: "failure" }], reviewDecision: "CHANGES_REQUESTED" }));
    expect(r.state).toBe("NOT_READY");
    expect(r.failingChecks).toEqual(["e2e"]);
    expect(r.reasons).toEqual(["Draft PR", "CI failing: e2e", "Changes requested"]);
    expect(r.score).toBe(0);
    expect(toReadiness(raw({ mergeable: "CONFLICTING" })).state).toBe("NOT_READY");
  });
  it("WAITING on pending checks, missing required checks, or required review", () => {
    expect(toReadiness(raw({ checks: [{ name: "build", state: "pending" }] })).state).toBe("WAITING");
    const missing = toReadiness(raw(), { requiredChecks: ["security-scan"], requiredApprovals: 1, mergeQueue: false, complete: true });
    expect(missing).toMatchObject({ state: "WAITING", ci: "pending", missingRequiredChecks: ["security-scan"] });
    expect(toReadiness(raw({ reviewDecision: "REVIEW_REQUIRED" })).state).toBe("WAITING");
  });
  it("no checks at all → ci none (still READY if approved)", () => {
    expect(toReadiness(raw({ checks: [] }))).toMatchObject({ ci: "none", state: "READY" });
  });
});

const ready = (score = 100): Readiness => ({ ...toReadiness(raw()), score });
const notReady = toReadiness(raw({ checks: [{ name: "unit", state: "failure" }] }));

// 1 → 2 → 3 (chain over a.ts / b.ts), 4 independent, 5 touches 1 (non-blocking)
const sample = () =>
  buildDependencyGraph([
    pr(1, 1, [file("a.ts", replaceLine(1, "x"))]),
    pr(2, 2, [file("a.ts", replaceLine(1, "y")), file("b.ts", replaceLine(1, "y"))]),
    pr(3, 3, [file("b.ts", replaceLine(1, "z"))]),
    pr(4, 4, [file("c.ts", replaceLine(1, "w"))]),
    pr(5, 5, [file("a.ts", insertBefore(90, "far away"))]),
  ]);

describe("planMerges", () => {
  it("batches independent ready PRs and walks the chain (pure topology)", () => {
    const plan = planMerges(sample());
    expect(plan.steps.map((s) => s.prs)).toEqual([["1", "4", "5"], ["2"], ["3"]]);
    expect(plan.steps[0].unlocks).toEqual(["2"]);
    expect(plan.steps[0].rationale).toContain("Unblocks #2");
    expect(plan.parked).toHaveLength(0);
    expect(plan.criticalPath).toEqual(["1", "2", "3"]);
  });

  it("orders a batch by transitive dependents (unblocks the most work first)", () => {
    expect(planMerges(sample()).steps[0].prs[0]).toBe("1");
  });

  it("parks not-ready PRs with reasons, and their dependents with waitingOn", () => {
    const r = new Map<string, Readiness>([
      ["1", ready()],
      ["2", notReady],
      ["3", ready()],
      ["4", ready()],
      ["5", ready()],
    ]);
    const plan = planMerges(sample(), r);
    expect(plan.steps.map((s) => s.prs)).toEqual([["1", "4", "5"]]);
    expect(plan.parked).toEqual([
      { id: "2", reasons: ["CI failing: unit"], waitingOn: [] },
      { id: "3", reasons: ["Waiting on #2"], waitingOn: ["2"] },
    ]);
  });

  it("parks deadlocked PRs with a human-decision reason", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("a.ts", hunk(1, ["-export function alpha() {", "+export function alpha2() {"])), file("c.ts", insertBefore(5, "beta();"))]),
      pr(2, 2, [file("b.ts", hunk(1, ["-export function beta() {", "+export function beta2() {"])), file("d.ts", insertBefore(5, "alpha();"))]),
    ]);
    const plan = planMerges(g);
    expect(plan.steps).toHaveLength(0);
    expect(plan.parked[0].reasons[0]).toMatch(/Deadlocked with #2/);
  });

  it("withMergePlan stamps readiness + planStep on nodes; planToMarkdown renders it", () => {
    const g = withMergePlan(sample(), new Map([["2", notReady]]));
    const step = (id: string) => g.nodes.find((n) => n.id === id)!.data.planStep;
    expect([step("1"), step("2"), step("3")]).toEqual([1, null, null]);
    expect(g.nodes.find((n) => n.id === "2")!.data.readiness?.state).toBe("NOT_READY");
    const md = planToMarkdown(g.mergePlan!, g, "acme/web");
    expect(md).toContain("### Merge plan — acme/web");
    expect(md).toContain("**Parked**");
    expect(md).toContain("#2 PR 2 — CI failing: unit");
  });
});

describe("whatIfMerge", () => {
  it("merging the head of a chain unblocks the next PR and clears soft dependencies", () => {
    const g = withMergePlan(sample());
    const res = whatIfMerge(g, ["1"]);
    expect(res.graph.nodes.map((n) => n.id)).not.toContain("1");
    expect(res.unblocked.map((c) => c.id)).toEqual(["2"]);
    expect(res.graph.mergePlan!.steps[0].prs).toContain("2");
    // #5 still touches a.ts alongside #2 → stays AT_RISK until #2 is merged too
    expect(res.changes.find((c) => c.id === "5")).toBeUndefined();
    const both = whatIfMerge(g, ["1", "2"]);
    expect(both.changes.find((c) => c.id === "5")).toMatchObject({ from: "AT_RISK", to: "SAFE" });
    expect(both.unblocked.map((c) => c.id)).toEqual(["3"]);
  });

  it("is pure (input untouched)", () => {
    const g = sample();
    const snap = JSON.stringify(g);
    whatIfMerge(g, ["1", "2"]);
    expect(JSON.stringify(g)).toBe(snap);
  });
});
