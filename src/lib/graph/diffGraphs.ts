import type { DependencyGraph, NodeStatus } from "./types";

export interface StatusChange {
  id: string;
  prNumber: number;
  title: string;
  from: NodeStatus;
  to: NodeStatus;
}

export interface GraphDiff {
  /** Node ids present in next but not prev (newly opened PRs). */
  added: string[];
  /** Node ids present in prev but not next (merged/closed PRs). */
  removed: string[];
  statusChanges: StatusChange[];
  /** PRs that became SAFE (were BLOCKED/DEADLOCKED before) — the headline for Slack. */
  newlyUnblocked: StatusChange[];
}

/**
 * Compare two graph snapshots and report the transitions. Pure — used by the recompute
 * worker to drive Socket.IO animations and the Slack "now safe to merge" notification.
 */
export function diffGraphs(prev: DependencyGraph | null, next: DependencyGraph): GraphDiff {
  const prevNodes = new Map((prev?.nodes ?? []).map((n) => [n.id, n]));
  const nextNodes = new Map(next.nodes.map((n) => [n.id, n]));

  const added: string[] = [];
  const removed: string[] = [];
  const statusChanges: StatusChange[] = [];
  const newlyUnblocked: StatusChange[] = [];

  for (const [id, n] of nextNodes) {
    if (!prevNodes.has(id)) {
      added.push(id);
      continue;
    }
    const before = prevNodes.get(id)!.data.status;
    const after = n.data.status;
    if (before !== after) {
      const change: StatusChange = {
        id,
        prNumber: n.data.prNumber,
        title: n.data.title,
        from: before,
        to: after,
      };
      statusChanges.push(change);
      if (after === "SAFE" && before !== "SAFE") newlyUnblocked.push(change);
    }
  }

  for (const id of prevNodes.keys()) if (!nextNodes.has(id)) removed.push(id);

  return { added, removed, statusChanges, newlyUnblocked };
}
