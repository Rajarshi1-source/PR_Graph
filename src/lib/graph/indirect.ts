import type { GraphEdge } from "./types";

export const MAX_INDIRECT_EDGES = 200;

export const compareIds = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b);

/**
 * Transitive dependencies over BLOCKING edges: A ⇝ C (distance ≥ 2) with no direct edge between
 * them becomes a non-blocking INDIRECT edge carrying the shortest path in `via`. Capped and
 * deterministically ordered. Pure.
 */
export function indirectEdges(nodeIds: string[], blocking: GraphEdge[], allEdges: GraphEdge[]): GraphEdge[] {
  const adj = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of blocking) adj.get(e.source)?.push(e.target);
  for (const list of adj.values()) list.sort(compareIds);

  const direct = new Set<string>();
  for (const e of allEdges) {
    direct.add(`${e.source}>${e.target}`);
    direct.add(`${e.target}>${e.source}`);
  }

  const out: GraphEdge[] = [];
  for (const s of [...nodeIds].sort(compareIds)) {
    const prev = new Map<string, string>();
    const dist = new Map<string, number>([[s, 0]]);
    const queue = [s];
    while (queue.length) {
      const u = queue.shift()!;
      for (const v of adj.get(u) ?? []) {
        if (dist.has(v)) continue;
        dist.set(v, dist.get(u)! + 1);
        prev.set(v, u);
        queue.push(v);
      }
    }
    const reached = [...dist.entries()]
      .filter(([t, d]) => d >= 2 && t !== s && !direct.has(`${s}>${t}`))
      .map(([t]) => t)
      .sort(compareIds);
    for (const t of reached) {
      const via: string[] = [];
      for (let c = prev.get(t); c && c !== s; c = prev.get(c)) via.unshift(c);
      out.push({
        id: `indirect:${s}-${t}`,
        source: s,
        target: t,
        type: "INDIRECT",
        sharedFiles: [],
        blocking: false,
        severity: "low",
        evidence: "transitive",
        certainty: "exact",
        via,
      });
      if (out.length >= MAX_INDIRECT_EDGES) return out;
    }
  }
  return out;
}
