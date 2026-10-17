import {
  GRAPH_SCHEMA_VERSION,
  type DependencyGraph,
  type GraphEdge,
  type GraphNode,
  type MergePlan,
  type NodeStatus,
} from "./types";
import { topologicalSort } from "./topologicalSort";
import { detectCycles } from "./cycleDetection";
import { indirectEdges, compareIds } from "./indirect";

/**
 * Re-derive everything that depends on the edge set: cycles, status, neighbour lists, INDIRECT
 * edges, Kahn merge order and stats — all over BLOCKING edges. Shared by the builder, the AI
 * refinement, deep verify and what-if so the rules live in one place. Pure.
 */
export function deriveGraph(
  nodes: GraphNode[],
  inputEdges: GraphEdge[],
  mergePlan?: MergePlan,
): DependencyGraph {
  const edges = inputEdges
    .filter((e) => e.type !== "INDIRECT")
    .sort((a, b) => compareIds(a.source, b.source) || compareIds(a.target, b.target) || a.id.localeCompare(b.id));
  const blocking = edges.filter((e) => e.blocking);
  const ids = nodes.map((n) => n.id);

  const cycles = detectCycles(ids, blocking);
  const inCycle = new Set(cycles.flat());
  const hardIn = new Map<string, string[]>(ids.map((id) => [id, []]));
  const hardOut = new Map<string, string[]>(ids.map((id) => [id, []]));
  const softIn = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (e.blocking) {
      hardIn.get(e.target)?.push(e.source);
      hardOut.get(e.source)?.push(e.target);
    } else {
      softIn.get(e.target)?.push(e.source);
    }
  }

  const indirect = indirectEdges(ids, blocking, edges);
  const transitive = new Map<string, string[]>();
  for (const e of indirect) {
    const arr = transitive.get(e.target);
    if (arr) arr.push(e.source);
    else transitive.set(e.target, [e.source]);
  }

  const classify = (id: string): NodeStatus => {
    if (inCycle.has(id)) return "DEADLOCKED";
    if ((hardIn.get(id) ?? []).length) return "BLOCKED";
    if ((softIn.get(id) ?? []).length) return "AT_RISK";
    return "SAFE";
  };
  const uniq = (xs: string[]) => [...new Set(xs)].sort(compareIds);

  const derivedNodes: GraphNode[] = nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      status: classify(n.id),
      blockedBy: uniq(hardIn.get(n.id) ?? []),
      blocking: uniq(hardOut.get(n.id) ?? []),
      relatedTo: uniq(softIn.get(n.id) ?? []),
      transitivelyBlockedBy: uniq(transitive.get(n.id) ?? []),
    },
  }));

  const count = (s: NodeStatus) => derivedNodes.filter((n) => n.data.status === s).length;

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: derivedNodes,
    edges: [...edges, ...indirect],
    mergeOrder: topologicalSort(derivedNodes, blocking),
    cycles,
    stats: {
      totalPRs: derivedNodes.length,
      safePRs: count("SAFE"),
      atRiskPRs: count("AT_RISK"),
      blockedPRs: count("BLOCKED"),
      deadlockedPRs: count("DEADLOCKED"),
      totalDependencies: edges.length,
      blockingDependencies: blocking.length,
    },
    ...(mergePlan ? { mergePlan } : {}),
  };
}
