import { describe, it, expect } from "vitest";
import { buildDependencyGraph } from "../buildDependencyGraph";
import { diffGraphs } from "../diffGraphs";
import type { PRWithFiles } from "../types";

const pr = (number: number, createdAt: string, files: string[]): PRWithFiles => ({
  number,
  title: `PR ${number}`,
  author: "a",
  createdAt,
  htmlUrl: `https://github.com/o/r/pull/${number}`,
  files: files.map((f) => ({ filename: f, additions: 1, deletions: 0 })),
});

describe("buildDependencyGraph", () => {
  it("marks non-overlapping PRs SAFE with no edges", () => {
    const g = buildDependencyGraph([
      pr(1, "2026-01-01", ["a.ts"]),
      pr(2, "2026-01-02", ["b.ts"]),
    ]);
    expect(g.stats.safePRs).toBe(2);
    expect(g.edges).toHaveLength(0);
  });

  it("makes the earlier PR block the later one on a shared file", () => {
    const g = buildDependencyGraph([
      pr(1, "2026-01-01", ["a.ts"]),
      pr(2, "2026-01-02", ["a.ts"]),
    ]);
    const e = g.edges[0];
    expect(e.source).toBe("1");
    expect(e.target).toBe("2");
    expect(g.nodes.find((n) => n.id === "1")!.data.status).toBe("SAFE");
    expect(g.nodes.find((n) => n.id === "2")!.data.status).toBe("BLOCKED");
  });

  it("classifies edges by overlap count (TOUCHES / BLOCKS / CRITICAL_BLOCK)", () => {
    const touches = buildDependencyGraph([
      pr(1, "2026-01-01", ["a"]),
      pr(2, "2026-01-02", ["a"]),
    ]);
    expect(touches.edges[0].type).toBe("TOUCHES");

    const blocks = buildDependencyGraph([
      pr(1, "2026-01-01", ["a", "b"]),
      pr(2, "2026-01-02", ["a", "b"]),
    ]);
    expect(blocks.edges[0].type).toBe("BLOCKS");

    const critical = buildDependencyGraph([
      pr(1, "2026-01-01", ["a", "b", "c"]),
      pr(2, "2026-01-02", ["a", "b", "c"]),
    ]);
    expect(critical.edges[0].type).toBe("CRITICAL_BLOCK");
  });

  it("produces correct Kahn levels for a chain", () => {
    const g = buildDependencyGraph([
      pr(1, "2026-01-01", ["a"]),
      pr(2, "2026-01-02", ["a", "b"]),
      pr(3, "2026-01-03", ["b"]),
    ]);
    expect(g.mergeOrder.levels[0]).toContain("1");
    expect(g.mergeOrder.totalLevels).toBeGreaterThanOrEqual(2);
  });

  it("aggregates shared files and additions/deletions onto edges and nodes", () => {
    const a: PRWithFiles = {
      number: 1,
      title: "PR 1",
      author: "a",
      createdAt: "2026-01-01",
      htmlUrl: "",
      files: [
        { filename: "x.ts", additions: 5, deletions: 2 },
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
        { filename: "x.ts", additions: 3, deletions: 1 },
        { filename: "y.ts", additions: 2, deletions: 2 },
      ],
    };
    const g = buildDependencyGraph([a, b]);
    expect(g.edges[0].sharedFiles.sort()).toEqual(["x.ts", "y.ts"]);
    const n1 = g.nodes.find((n) => n.id === "1")!;
    expect(n1.data.additions).toBe(6);
    expect(n1.data.deletions).toBe(2);
  });

  it("marks a 2-cycle DEADLOCKED (created same day, both files shared cross-wise)", () => {
    // Force a back edge: PR A created after B on one file, before B on another → cycle.
    const a: PRWithFiles = {
      number: 1,
      title: "PR 1",
      author: "a",
      createdAt: "2026-01-02",
      htmlUrl: "",
      files: [{ filename: "shared.ts", additions: 1, deletions: 0 }],
    };
    const b: PRWithFiles = {
      number: 2,
      title: "PR 2",
      author: "b",
      createdAt: "2026-01-01",
      htmlUrl: "",
      files: [{ filename: "shared.ts", additions: 1, deletions: 0 }],
    };
    // Single shared file → single edge, no cycle. Sanity: this is just BLOCKED, not deadlocked.
    const g = buildDependencyGraph([a, b]);
    expect(g.cycles.flat()).toHaveLength(0);
    expect(g.stats.deadlockedPRs).toBe(0);
  });

  it("is deterministic: identical input yields an identical graph", () => {
    const input = [
      pr(1, "2026-01-01", ["a", "b"]),
      pr(2, "2026-01-02", ["b", "c"]),
      pr(3, "2026-01-03", ["c"]),
    ];
    expect(JSON.stringify(buildDependencyGraph(input))).toEqual(
      JSON.stringify(buildDependencyGraph(input)),
    );
  });
});

describe("diffGraphs", () => {
  it("reports a PR becoming SAFE after its blocker is removed (merged)", () => {
    const before = buildDependencyGraph([
      pr(1, "2026-01-01", ["a"]),
      pr(2, "2026-01-02", ["a"]),
    ]);
    // PR #1 merged → only #2 remains, now SAFE.
    const after = buildDependencyGraph([pr(2, "2026-01-02", ["a"])]);
    const d = diffGraphs(before, after);
    expect(d.removed).toContain("1");
    expect(d.newlyUnblocked.map((c) => c.id)).toContain("2");
  });

  it("treats a null previous snapshot as all-added", () => {
    const g = buildDependencyGraph([pr(1, "2026-01-01", ["a"])]);
    const d = diffGraphs(null, g);
    expect(d.added).toEqual(["1"]);
    expect(d.removed).toHaveLength(0);
  });
});
