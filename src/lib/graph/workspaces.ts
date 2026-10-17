import type { DependencyGraph, NodeStatus } from "./types";
import { globToRegExp } from "./ignore";

export const DEFAULT_WORKSPACE_GLOBS = ["apps/*", "packages/*", "services/*", "libs/*", "modules/*"];
export const ROOT_WORKSPACE = "(root)";

/**
 * Monorepo workspace of a file: the first configured glob whose prefix matches (`apps/*` →
 * `apps/web`), else the top-level directory, else `(root)`. Pure.
 */
export function workspaceOf(path: string, globs: readonly string[] = DEFAULT_WORKSPACE_GLOBS): string {
  for (const g of globs) {
    const depth = g.split("/").length;
    const prefix = path.split("/").slice(0, depth).join("/");
    if (path.split("/").length > depth && globToRegExp(g).test(prefix)) return prefix;
  }
  const i = path.indexOf("/");
  return i < 0 ? ROOT_WORKSPACE : path.slice(0, i);
}

export function workspacesOf(files: readonly string[], globs?: readonly string[]): string[] {
  return [...new Set(files.map((f) => workspaceOf(f, globs)))].sort();
}

export interface WorkspaceNode {
  id: string;
  prs: string[];
  counts: Record<NodeStatus, number>;
}

export interface WorkspaceEdge {
  source: string;
  target: string;
  /** Number of blocking PR edges crossing between the two workspaces. */
  blocking: number;
  total: number;
}

/**
 * Collapse a PR graph to a workspace graph (monorepo level of detail): one node per workspace with
 * status counts, one edge per workspace pair with the number of PR edges crossing it. Pure.
 */
export function aggregateByWorkspace(graph: DependencyGraph): {
  nodes: WorkspaceNode[];
  edges: WorkspaceEdge[];
} {
  const nodes = new Map<string, WorkspaceNode>();
  const wsOf = new Map<string, string[]>();
  for (const n of graph.nodes) {
    const ws = n.data.workspaces?.length ? n.data.workspaces : [ROOT_WORKSPACE];
    wsOf.set(n.id, ws);
    for (const w of ws) {
      const node =
        nodes.get(w) ??
        { id: w, prs: [], counts: { SAFE: 0, AT_RISK: 0, BLOCKED: 0, DEADLOCKED: 0 } };
      node.prs.push(n.id);
      node.counts[n.data.status]++;
      nodes.set(w, node);
    }
  }

  const edges = new Map<string, WorkspaceEdge>();
  for (const e of graph.edges) {
    if (e.type === "INDIRECT") continue;
    for (const ws of wsOf.get(e.source) ?? [])
      for (const wt of wsOf.get(e.target) ?? []) {
        if (ws === wt) continue;
        const key = `${ws}\u0000${wt}`;
        const agg = edges.get(key) ?? { source: ws, target: wt, blocking: 0, total: 0 };
        agg.total++;
        if (e.blocking) agg.blocking++;
        edges.set(key, agg);
      }
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort(
      (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    ),
  };
}
