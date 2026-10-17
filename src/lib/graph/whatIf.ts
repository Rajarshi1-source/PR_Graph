import type { DependencyGraph } from "./types";
import { deriveGraph } from "./derive";
import { diffGraphs, type StatusChange } from "./diffGraphs";
import { withMergePlan } from "./mergePlan";

export interface WhatIfResult {
  /** The graph after the given PRs are merged (removed with their edges). */
  graph: DependencyGraph;
  /** Every status transition among the remaining PRs. */
  changes: StatusChange[];
  /** The subset that leaves BLOCKED / DEADLOCKED. */
  unblocked: StatusChange[];
}

/**
 * "What happens if we merge these PRs?" — remove them (and their edges), re-derive status / cycles /
 * merge order / plan, and report the transitions. Pure; runs on the client for instant feedback.
 * (A merged PR's TOUCHES neighbours also lose their soft dependency, so AT_RISK → SAFE shows up.)
 */
export function whatIfMerge(graph: DependencyGraph, prIds: string[]): WhatIfResult {
  const gone = new Set(prIds);
  const nodes = graph.nodes.filter((n) => !gone.has(n.id));
  const edges = graph.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target));
  const derived = deriveGraph(nodes, edges);
  const next = graph.mergePlan ? withMergePlan(derived) : derived;
  const diff = diffGraphs(graph, next);
  return { graph: next, changes: diff.statusChanges, unblocked: diff.newlyUnblocked };
}
