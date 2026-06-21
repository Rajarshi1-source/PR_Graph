import type { GraphNode, GraphEdge, MergeOrder } from "./types";

/**
 * Kahn's algorithm, emitted as levels (the merge order):
 *   level 0 = safe to merge now (in-degree 0), level 1 = after level 0, etc.
 * Any nodes that never reach in-degree 0 are in a cycle. Pure, O(V+E).
 */
export function topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): MergeOrder {
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  const levels: string[][] = [];
  let frontier = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);

  while (frontier.length) {
    levels.push(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        const d = (indeg.get(nb) ?? 0) - 1;
        indeg.set(nb, d);
        if (d === 0) next.push(nb);
      }
    }
    frontier = next;
  }

  const processed = new Set(levels.flat());
  const inCycle = nodes.filter((n) => !processed.has(n.id)).map((n) => n.id);
  return { levels, inCycle, totalLevels: levels.length };
}
