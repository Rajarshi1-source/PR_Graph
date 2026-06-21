import type { DependencyGraph, GraphEdge, GraphNode, NodeStatus } from "./types";
import type { ConflictVerdict } from "@/lib/ai/types";
import { topologicalSort } from "./topologicalSort";
import { detectCycles } from "./cycleDetection";

/**
 * Pure AI-refinement stage (Phase 2). Given the deterministic graph and a per-edge verdict map,
 * annotate each overlapping edge with its semantic verdict, demote CO_LOCATED edges to
 * non-blocking, then re-derive everything that depends on the blocking subgraph (in-degree,
 * cycles, node status, merge order, stats).
 *
 * No I/O, no Date.now, no randomness — same graph + same verdicts ⇒ same refined graph, so the
 * demotion logic is trivially unit-testable. A CO_LOCATED demotion can flip a node BLOCKED→SAFE
 * and can break a deadlock cycle.
 */
export function refineGraph(
  graph: DependencyGraph,
  verdicts: Map<string, ConflictVerdict>,
): DependencyGraph {
  // 1. annotate + demote (new edge objects — never mutate the input)
  const edges: GraphEdge[] = graph.edges.map((e) => {
    const v = verdicts.get(e.id);
    if (!v) return { ...e };
    const refined: GraphEdge = {
      ...e,
      semanticVerdict: v.verdict,
      explanation: v.explanation,
    };
    if (v.verdict === "CO_LOCATED") refined.type = "CO_LOCATED";
    return refined;
  });

  // 2. blocking subgraph = everything except demoted CO_LOCATED edges
  const blocking = edges.filter((e) => e.type !== "CO_LOCATED");
  const nodeIds = graph.nodes.map((n) => n.id);

  // 3. re-derive cycles + in-degree → status over the blocking subgraph
  const cycles = detectCycles(nodeIds, blocking);
  const inCycle = new Set(cycles.flat());
  const incoming = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const e of blocking) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);

  const classify = (id: string): NodeStatus =>
    inCycle.has(id) ? "DEADLOCKED" : (incoming.get(id) ?? 0) === 0 ? "SAFE" : "BLOCKED";

  const nodes: GraphNode[] = graph.nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      status: classify(n.id),
      blockedBy: blocking.filter((e) => e.target === n.id).map((e) => e.source),
      blocking: blocking.filter((e) => e.source === n.id).map((e) => e.target),
    },
  }));

  // 4. merge order over the blocking subgraph
  const mergeOrder = topologicalSort(nodes, blocking);

  return {
    nodes,
    edges,
    mergeOrder,
    cycles,
    stats: {
      totalPRs: nodes.length,
      safePRs: nodes.filter((n) => n.data.status === "SAFE").length,
      blockedPRs: nodes.filter((n) => n.data.status === "BLOCKED").length,
      deadlockedPRs: nodes.filter((n) => n.data.status === "DEADLOCKED").length,
      totalDependencies: edges.length,
    },
  };
}
