/**
 * Graph engine type definitions — the shared DTO imported by both server and client.
 * Never re-declare these shapes in the UI (frontend skill rule).
 */

export type NodeStatus = "SAFE" | "BLOCKED" | "DEADLOCKED";

/** Edge severity from the deterministic engine (by file-overlap count). */
export type EdgeType = "TOUCHES" | "BLOCKS" | "CRITICAL_BLOCK" | "CO_LOCATED";

/** Phase-2 AI refinement verdict attached to an overlapping edge. */
export type SemanticVerdict = "TRUE_CONFLICT" | "CO_LOCATED" | "UNCERTAIN";

export interface PRFile {
  filename: string;
  additions: number;
  deletions: number;
  status?: string;
  /** Unified-diff hunk — fed to the AI analyzer (Phase 2). Optional in the engine. */
  patch?: string;
}

/** Normalized PR shape that the pure engine consumes (decoupled from GitHub's raw API). */
export interface PRWithFiles {
  number: number;
  title: string;
  author: string;
  authorAvatar?: string;
  createdAt: string;
  htmlUrl: string;
  files: PRFile[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  sharedFiles: string[];
  /** Set when the AI layer has refined this edge (Phase 2). */
  semanticVerdict?: SemanticVerdict;
  explanation?: string;
}

export interface PRNodeData extends Record<string, unknown> {
  prNumber: number;
  title: string;
  author: string;
  authorAvatar?: string;
  createdAt: string;
  htmlUrl: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  status: NodeStatus;
  blockedBy: string[];
  blocking: string[];
}

export interface GraphNode {
  id: string;
  type: "prNode";
  position: { x: number; y: number };
  data: PRNodeData;
}

export interface MergeOrder {
  /** Kahn levels: level 0 = merge now, level 1 = merge after level 0, etc. */
  levels: string[][];
  /** Node ids that never reach in-degree 0 — they are in a cycle. */
  inCycle: string[];
  totalLevels: number;
}

export interface GraphStats {
  totalPRs: number;
  safePRs: number;
  blockedPRs: number;
  deadlockedPRs: number;
  totalDependencies: number;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mergeOrder: MergeOrder;
  cycles: string[][];
  stats: GraphStats;
}
