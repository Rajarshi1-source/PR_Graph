import type { GraphEdge } from "./types";

/**
 * DFS 3-colour cycle detection (white / grey / black).
 * A grey-on-grey edge is a back edge → the slice of the stack from that node is a cycle.
 * Returns the list of cycles (each a list of participating node ids). Pure.
 */
export function detectCycles(nodeIds: string[], edges: GraphEdge[]): string[][] {
  const adj = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) adj.get(e.source)?.push(e.target);

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(nodeIds.map((id) => [id, WHITE]));
  const stack: string[] = [];
  const cycles: string[][] = [];

  const dfs = (u: string) => {
    color.set(u, GREY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GREY) {
        const i = stack.indexOf(v);
        if (i >= 0) cycles.push(stack.slice(i));
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    color.set(u, BLACK);
    stack.pop();
  };

  for (const id of nodeIds) if (color.get(id) === WHITE) dfs(id);
  return cycles;
}
