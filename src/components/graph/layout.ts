import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { PRNodeData } from "@/lib/graph/types";

const NODE_W = 280;
const NODE_H = 132;

export type LayoutDirection = "LR" | "TB";

/**
 * Strategy pattern (plan §8.2): a layered dagre layout that mirrors merge order. Defaults to a
 * top-to-bottom hierarchy (frontend skill). Pure positioning — takes React Flow nodes/edges,
 * returns nodes with computed positions.
 */
export function layoutGraph(
  nodes: Node<PRNodeData>[],
  edges: Edge[],
  direction: LayoutDirection = "TB",
): Node<PRNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 48, ranksep: 96, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      targetPosition: direction === "LR" ? "left" : "top",
      sourcePosition: direction === "LR" ? "right" : "bottom",
    } as Node<PRNodeData>;
  });
}
