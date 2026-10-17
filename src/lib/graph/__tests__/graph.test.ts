import { describe, it, expect } from "vitest";
import { buildDependencyGraph } from "../buildDependencyGraph";
import { diffGraphs } from "../diffGraphs";
import { normalizeGraph } from "../normalize";
import { aggregateByWorkspace, workspaceOf } from "../workspaces";
import { file, pr, replaceLine, insertBefore, hunk } from "../__fixtures__/prs";

const node = (g: ReturnType<typeof buildDependencyGraph>, id: number) => g.nodes.find((n) => n.id === String(id))!;
const edge = (g: ReturnType<typeof buildDependencyGraph>, s: number, t: number) =>
  g.edges.find((e) => e.source === String(s) && e.target === String(t));

describe("buildDependencyGraph — line-level file edges", () => {
  it("marks non-overlapping PRs SAFE with no edges", () => {
    const g = buildDependencyGraph([pr(1, 1, [file("a.ts", replaceLine(3, "x"))]), pr(2, 2, [file("b.ts", replaceLine(3, "y"))])]);
    expect(g.edges).toHaveLength(0);
    expect(g.stats.safePRs).toBe(2);
    expect(g.schemaVersion).toBe(2);
  });

  it("overlapping lines → exact BLOCKS from the earlier PR, with conflict regions", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("src/auth.ts", replaceLine(42, "return verify(t, opts);"))]),
      pr(2, 2, [file("src/auth.ts", replaceLine(42, "return verify(t) ?? null;"))]),
    ]);
    const e = edge(g, 1, 2)!;
    expect(e).toMatchObject({ type: "BLOCKS", blocking: true, certainty: "exact", evidence: "patch", severity: "medium" });
    expect(e.conflicts![0]).toMatchObject({ file: "src/auth.ts", kind: "overlap" });
    expect(e.conflicts![0].regions[0]).toMatchObject({ baseStart: 42, baseEnd: 42 });
    expect(e.conflicts![0].regions[0].aPreview).toContain("+return verify(t, opts);");
    expect(node(g, 1).data.status).toBe("SAFE");
    expect(node(g, 2).data.status).toBe("BLOCKED");
    expect(node(g, 2).data.blockedBy).toEqual(["1"]);
  });

  it("adjacent lines conflict too (git's rule)", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(10, "x"))]),
      pr(2, 2, [file("a.ts", replaceLine(11, "y"))]),
    ]);
    expect(edge(g, 1, 2)!.type).toBe("BLOCKS");
  });

  it("disjoint regions → non-blocking TOUCHES; the later PR is AT_RISK, not BLOCKED", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(5, "top"))]),
      pr(2, 2, [file("a.ts", insertBefore(200, "bottom"))]),
    ]);
    const e = edge(g, 1, 2)!;
    expect(e).toMatchObject({ type: "TOUCHES", blocking: false, severity: "low" });
    expect(node(g, 2).data.status).toBe("AT_RISK");
    expect(node(g, 2).data.relatedTo).toEqual(["1"]);
    expect(g.mergeOrder.levels[0].sort()).toEqual(["1", "2"]); // both mergeable now
  });

  it("missing patch (binary / huge) → BLOCKS with approximate certainty", () => {
    const g = buildDependencyGraph([pr(1, 1, [file("logo.png")]), pr(2, 2, [file("logo.png")])]);
    expect(edge(g, 1, 2)).toMatchObject({ type: "BLOCKS", blocking: true, certainty: "approx", evidence: "unknown" });
  });

  it("base-SHA drift keeps the line verdict but marks it approximate", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(5, "x"))], { baseSha: "aaa" }),
      pr(2, 2, [file("a.ts", replaceLine(90, "y"))], { baseSha: "bbb" }),
    ]);
    expect(edge(g, 1, 2)).toMatchObject({ type: "TOUCHES", certainty: "approx" });
  });

  it("severity scales with the number of conflicting files (critical at 3+)", () => {
    const files = (t: string) => ["a.ts", "b.ts", "c.ts"].map((f) => file(f, replaceLine(1, t)));
    const g = buildDependencyGraph([pr(1, 1, files("x")), pr(2, 2, files("y"))]);
    expect(edge(g, 1, 2)!.severity).toBe("critical");
  });

  it("regenerable files (lockfiles) never block", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("package-lock.json", replaceLine(10, "a"))]),
      pr(2, 2, [file("package-lock.json", replaceLine(10, "b"))]),
    ]);
    expect(edge(g, 1, 2)).toMatchObject({ type: "TOUCHES", blocking: false });
    expect(edge(g, 1, 2)!.conflicts![0].kind).toBe("regenerable");
  });

  it("modify/delete is a blocking conflict; delete/delete is clean", () => {
    const md = buildDependencyGraph([
      pr(1, 1, [file("old.ts", replaceLine(1, "x"))]),
      pr(2, 2, [file("old.ts", hunk(1, ["-gone"]), { status: "removed" })]),
    ]);
    expect(edge(md, 1, 2)!.blocking).toBe(true);
    const dd = buildDependencyGraph([
      pr(1, 1, [file("old.ts", hunk(1, ["-gone"]), { status: "removed" })]),
      pr(2, 2, [file("old.ts", hunk(1, ["-gone"]), { status: "removed" })]),
    ]);
    expect(edge(dd, 1, 2)!.blocking).toBe(false);
  });

  it("produces Kahn levels over blocking edges for a chain", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(1, "x"))]),
      pr(2, 2, [file("a.ts", replaceLine(1, "y")), file("b.ts", replaceLine(1, "y"))]),
      pr(3, 3, [file("b.ts", replaceLine(1, "z"))]),
    ]);
    expect(g.mergeOrder.levels).toEqual([["1"], ["2"], ["3"]]);
  });

  it("derives non-blocking INDIRECT edges for transitive blockers", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(1, "x"))]),
      pr(2, 2, [file("a.ts", replaceLine(1, "y")), file("b.ts", replaceLine(1, "y"))]),
      pr(3, 3, [file("b.ts", replaceLine(1, "z"))]),
    ]);
    const ind = g.edges.find((e) => e.type === "INDIRECT")!;
    expect(ind).toMatchObject({ source: "1", target: "3", blocking: false, via: ["2"] });
    expect(node(g, 3).data.transitivelyBlockedBy).toEqual(["1"]);
    expect(g.stats.totalDependencies).toBe(2); // INDIRECT edges are not counted
  });

  it("aggregates shared files and additions/deletions", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("x.ts", replaceLine(1, "a"), { additions: 5, deletions: 2 }), file("y.ts", replaceLine(9, "a"))]),
      pr(2, 2, [file("x.ts", replaceLine(50, "b")), file("y.ts", replaceLine(90, "b"))]),
    ]);
    expect(edge(g, 1, 2)!.sharedFiles).toEqual(["x.ts", "y.ts"]);
    expect(node(g, 1).data.additions).toBe(6);
  });

  it("is deterministic regardless of input order", () => {
    const input = [
      pr(1, 1, [file("a", replaceLine(1, "x")), file("b", replaceLine(4, "x"))]),
      pr(2, 2, [file("b", replaceLine(4, "y")), file("c", replaceLine(1, "y"))]),
      pr(3, 3, [file("c", replaceLine(30, "z"))]),
    ];
    expect(JSON.stringify(buildDependencyGraph(input))).toEqual(JSON.stringify(buildDependencyGraph([...input].reverse())));
  });
});

describe("buildDependencyGraph — stacked and semantic edges", () => {
  it("stacked PRs: parent → child even when the child is older", () => {
    const g = buildDependencyGraph([
      pr(1, 5, [file("a.ts", replaceLine(1, "x"))], { headRef: "feat/base", baseRef: "main" }),
      pr(2, 1, [file("b.ts", replaceLine(1, "y"))], { headRef: "feat/child", baseRef: "feat/base" }),
    ]);
    expect(edge(g, 1, 2)).toMatchObject({ type: "STACKED", blocking: true, certainty: "exact" });
    expect(node(g, 2).data.status).toBe("BLOCKED");
  });

  it("cross-file symbol impact: a rename used elsewhere → SEMANTIC definer → user", () => {
    const g = buildDependencyGraph([
      // #2 is OLDER but uses the symbol; #1 renames it later → edge must go 1 → 2.
      pr(1, 5, [file("src/user.ts", hunk(10, ["-export function getUser(id: string) {", "+export function fetchUser(id: string) {"]))]),
      pr(2, 1, [file("src/profile.ts", insertBefore(30, "  const u = getUser(session.id);"))]),
    ]);
    const e = edge(g, 1, 2)!;
    expect(e).toMatchObject({ type: "SEMANTIC", blocking: true, certainty: "approx", severity: "high" });
    expect(e.symbols).toEqual([{ name: "getUser", change: "renamed", defFile: "src/user.ts", refFile: "src/profile.ts" }]);
    expect(edge(g, 2, 1)).toBeUndefined();
  });

  it("a body-only change to a definition creates no SEMANTIC edge", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [file("src/user.ts", hunk(12, ["-  return db.get(id);", "+  return db.get(id) ?? null;"], "export function getUser(id: string) {"))]),
      pr(2, 2, [file("src/profile.ts", insertBefore(30, "  const u = getUser(session.id);"))]),
    ]);
    expect(g.edges).toHaveLength(0);
  });

  it("file overlap between a semantic pair merges into one edge (textual conflict wins the type)", () => {
    const g = buildDependencyGraph([
      pr(1, 5, [
        file("src/user.ts", hunk(10, ["-export function getUser(id: string) {", "+export function getUser(id: string, opts: Opts) {"])),
        file("src/shared.ts", replaceLine(7, "a")),
      ]),
      pr(2, 1, [file("src/profile.ts", insertBefore(30, "getUser(x)")), file("src/shared.ts", replaceLine(7, "b"))]),
    ]);
    const pairEdges = g.edges.filter((e) => e.type !== "INDIRECT");
    expect(pairEdges).toHaveLength(1);
    expect(pairEdges[0]).toMatchObject({ source: "1", target: "2", type: "BLOCKS", certainty: "exact" });
    expect(pairEdges[0].symbols?.[0].change).toBe("signature");
  });

  it("mutual semantic dependencies are a real DEADLOCK", () => {
    const g = buildDependencyGraph([
      pr(1, 1, [
        file("a.ts", hunk(1, ["-export function alpha() {", "+export function alphaV2() {"])),
        file("c.ts", insertBefore(5, "beta();")),
      ]),
      pr(2, 2, [
        file("b.ts", hunk(1, ["-export function beta() {", "+export function betaV2() {"])),
        file("d.ts", insertBefore(5, "alpha();")),
      ]),
    ]);
    expect(node(g, 1).data.status).toBe("DEADLOCKED");
    expect(node(g, 2).data.status).toBe("DEADLOCKED");
    expect(g.mergeOrder.inCycle.sort()).toEqual(["1", "2"]);
  });

  it("convention-only file edges never fabricate a deadlock", () => {
    // 1 →(semantic) 2, and 2 is older than 1 on a shared file: the file edge follows the hard order.
    const g = buildDependencyGraph([
      pr(1, 9, [file("x.ts", hunk(1, ["-export function f1() {", "+export function f1b() {"])), file("s.ts", replaceLine(3, "a"))]),
      pr(2, 1, [file("y.ts", insertBefore(4, "f1();")), file("s.ts", replaceLine(40, "b"))]),
    ]);
    expect(g.cycles).toHaveLength(0);
  });
});

describe("workspaces", () => {
  it("detects monorepo workspaces and aggregates the graph", () => {
    expect(workspaceOf("apps/web/src/page.tsx")).toBe("apps/web");
    expect(workspaceOf("packages/ui/button.tsx")).toBe("packages/ui");
    expect(workspaceOf("src/index.ts")).toBe("src");
    expect(workspaceOf("README.md")).toBe("(root)");
    expect(workspaceOf("services/api/x.go", ["services/*"])).toBe("services/api");

    const g = buildDependencyGraph([
      pr(1, 1, [file("packages/ui/button.tsx", replaceLine(3, "x"))]),
      pr(2, 2, [file("packages/ui/button.tsx", replaceLine(3, "y")), file("apps/web/page.tsx", replaceLine(1, "y"))]),
    ]);
    expect(node(g, 2).data.workspaces).toEqual(["apps/web", "packages/ui"]);
    const agg = aggregateByWorkspace(g);
    expect(agg.nodes.map((n) => n.id)).toEqual(["apps/web", "packages/ui"]);
    expect(agg.edges).toEqual([{ source: "packages/ui", target: "apps/web", blocking: 1, total: 1 }]);
  });
});

describe("diffGraphs", () => {
  it("reports a PR leaving BLOCKED after its blocker is merged", () => {
    const before = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(1, "x"))]),
      pr(2, 2, [file("a.ts", replaceLine(1, "y"))]),
    ]);
    const after = buildDependencyGraph([pr(2, 2, [file("a.ts", replaceLine(1, "y"))])]);
    const d = diffGraphs(before, after);
    expect(d.removed).toContain("1");
    expect(d.newlyUnblocked.map((c) => c.id)).toEqual(["2"]);
  });

  it("BLOCKED → AT_RISK counts as unblocked; AT_RISK → SAFE does not", () => {
    const blocked = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(1, "x"))]),
      pr(2, 2, [file("a.ts", replaceLine(1, "y"))]),
    ]);
    const atRisk = buildDependencyGraph([
      pr(1, 1, [file("a.ts", replaceLine(1, "x"))]),
      pr(2, 2, [file("a.ts", replaceLine(80, "y"))]),
    ]);
    expect(diffGraphs(blocked, atRisk).newlyUnblocked.map((c) => c.to)).toEqual(["AT_RISK"]);
    const safe = buildDependencyGraph([pr(2, 2, [file("a.ts", replaceLine(80, "y"))])]);
    expect(diffGraphs(atRisk, safe).newlyUnblocked).toHaveLength(0);
  });

  it("treats a null previous snapshot as all-added", () => {
    const g = buildDependencyGraph([pr(1, 1, [file("a.ts", replaceLine(1, "x"))])]);
    expect(diffGraphs(null, g)).toMatchObject({ added: ["1"], removed: [] });
  });
});

describe("normalizeGraph", () => {
  const v1 = {
    nodes: [
      { id: "1", type: "prNode", position: { x: 0, y: 0 }, data: { prNumber: 1, title: "a", status: "SAFE", blockedBy: [], blocking: ["2"] } },
      { id: "2", type: "prNode", position: { x: 0, y: 0 }, data: { prNumber: 2, title: "b", status: "BLOCKED", blockedBy: ["1"], blocking: [] } },
    ],
    edges: [{ id: "1-2", source: "1", target: "2", type: "CRITICAL_BLOCK", sharedFiles: ["a", "b", "c"] }],
    mergeOrder: { levels: [["1"], ["2"]], inCycle: [], totalLevels: 2 },
    cycles: [],
    stats: { totalPRs: 2, safePRs: 1, blockedPRs: 1, deadlockedPRs: 0, totalDependencies: 1 },
  };

  it("upgrades a v1 snapshot (CRITICAL_BLOCK → BLOCKS + critical, blocking derived)", () => {
    const g = normalizeGraph(v1)!;
    expect(g.schemaVersion).toBe(2);
    expect(g.edges[0]).toMatchObject({ type: "BLOCKS", severity: "critical", blocking: true, certainty: "approx" });
    expect(g.stats).toMatchObject({ atRiskPRs: 0, blockingDependencies: 1 });
  });

  it("is idempotent on v2 graphs and rejects non-graphs", () => {
    const g = buildDependencyGraph([pr(1, 1, [file("a.ts", replaceLine(1, "x"))]), pr(2, 2, [file("a.ts", replaceLine(1, "y"))])]);
    expect(normalizeGraph(g)).toEqual(g);
    expect(normalizeGraph(null)).toBeNull();
    expect(normalizeGraph({ foo: 1 })).toBeNull();
  });
});
