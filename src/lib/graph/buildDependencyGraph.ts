import type {
  PRWithFiles,
  DependencyGraph,
  GraphEdge,
  GraphNode,
  NodeStatus,
} from "./types";
import { topologicalSort } from "./topologicalSort";
import { detectCycles } from "./cycleDetection";

/**
 * Build a dependency DAG from PRs and their changed files.
 *
 * PURE & DETERMINISTIC: data in → graph out. No I/O, no Date.now, no randomness, so the
 * same input always yields the identical graph (trivially testable + cacheable). The AI
 * layer (Phase 2) sits on top as an optional refinement.
 *
 * Algorithm:
 *   1. inverted index: filename → PRs touching it
 *   2. pairwise overlaps → edges (earlier PR by createdAt blocks the later one)
 *   3. classify edge severity by shared-file count
 *   4. cycles + in-degree → node status (SAFE / BLOCKED / DEADLOCKED)
 *   5. Kahn topological sort → merge order
 */
export function buildDependencyGraph(prs: PRWithFiles[]): DependencyGraph {
  // 1. inverted index
  const byFile = new Map<string, PRWithFiles[]>();
  for (const pr of prs) {
    for (const f of pr.files) {
      const arr = byFile.get(f.filename);
      if (arr) arr.push(pr);
      else byFile.set(f.filename, [pr]);
    }
  }

  // 2. pairwise overlaps → edges (earlier PR blocks the later one)
  const edges = new Map<string, GraphEdge>();
  for (const [filename, touch] of byFile) {
    if (touch.length < 2) continue;
    for (let i = 0; i < touch.length; i++) {
      for (let j = i + 1; j < touch.length; j++) {
        const [a, b] = earlierFirst(touch[i], touch[j]);
        const id = `${a.number}-${b.number}`;
        const e = edges.get(id);
        if (e) e.sharedFiles.push(filename);
        else
          edges.set(id, {
            id,
            source: String(a.number),
            target: String(b.number),
            type: "BLOCKS",
            sharedFiles: [filename],
          });
      }
    }
  }

  // 3. classify edge severity by overlap count
  for (const e of edges.values()) {
    e.type =
      e.sharedFiles.length >= 3
        ? "CRITICAL_BLOCK"
        : e.sharedFiles.length === 1
          ? "TOUCHES"
          : "BLOCKS";
  }

  const edgeList = [...edges.values()];

  // 4. cycles + in-degree → node status
  const cycles = detectCycles(
    prs.map((p) => String(p.number)),
    edgeList,
  );
  const inCycle = new Set(cycles.flat());
  const incoming = new Map<string, number>(prs.map((p) => [String(p.number), 0]));
  for (const e of edgeList) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);

  const classify = (id: string): NodeStatus =>
    inCycle.has(id) ? "DEADLOCKED" : (incoming.get(id) ?? 0) === 0 ? "SAFE" : "BLOCKED";

  const nodes: GraphNode[] = prs.map((pr) => ({
    id: String(pr.number),
    type: "prNode",
    position: { x: 0, y: 0 }, // dagre sets this on the client
    data: {
      prNumber: pr.number,
      title: pr.title,
      author: pr.author,
      authorAvatar: pr.authorAvatar,
      createdAt: pr.createdAt,
      htmlUrl: pr.htmlUrl,
      filesChanged: pr.files.length,
      additions: pr.files.reduce((s, f) => s + f.additions, 0),
      deletions: pr.files.reduce((s, f) => s + f.deletions, 0),
      status: classify(String(pr.number)),
      blockedBy: edgeList
        .filter((e) => e.target === String(pr.number))
        .map((e) => e.source),
      blocking: edgeList
        .filter((e) => e.source === String(pr.number))
        .map((e) => e.target),
    },
  }));

  // 5. merge order
  const mergeOrder = topologicalSort(nodes, edgeList);

  return {
    nodes,
    edges: edgeList,
    mergeOrder,
    cycles,
    stats: {
      totalPRs: prs.length,
      safePRs: nodes.filter((n) => n.data.status === "SAFE").length,
      blockedPRs: nodes.filter((n) => n.data.status === "BLOCKED").length,
      deadlockedPRs: nodes.filter((n) => n.data.status === "DEADLOCKED").length,
      totalDependencies: edgeList.length,
    },
  };
}

/** Order a pair so the earlier-created PR (by createdAt, tie-broken by number) is first. */
function earlierFirst(a: PRWithFiles, b: PRWithFiles): [PRWithFiles, PRWithFiles] {
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return ta < tb ? [a, b] : [b, a];
  return a.number <= b.number ? [a, b] : [b, a];
}
