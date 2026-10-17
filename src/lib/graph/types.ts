/**
 * Graph engine type definitions — the shared DTO imported by both server and client.
 * Never re-declare these shapes in the UI (frontend skill rule).
 *
 * Schema v2 (Phase 3): line-level edge classification, SEMANTIC / STACKED / INDIRECT edges, the
 * AT_RISK status, readiness and the merge plan. Older (v1) payloads are upgraded by
 * `normalizeGraph` at every read boundary.
 */

export const GRAPH_SCHEMA_VERSION = 2 as const;

/**
 * Node status, computed over BLOCKING edges only:
 *   DEADLOCKED — in a cycle of blocking edges
 *   BLOCKED    — has a blocking in-edge
 *   AT_RISK    — no blocking in-edge but a non-blocking one ("has dependencies")
 *   SAFE       — no in-edges
 */
export type NodeStatus = "SAFE" | "AT_RISK" | "BLOCKED" | "DEADLOCKED";

/**
 * BLOCKS     — changed base regions overlap/are adjacent in a shared file (git would conflict)
 * TOUCHES    — same file(s), disjoint regions (merges cleanly) — non-blocking
 * SEMANTIC   — source changes a symbol the target newly references in another file
 * STACKED    — target's base branch is source's head branch
 * INDIRECT   — transitive dependency over blocking edges (display only) — non-blocking
 * CO_LOCATED — approximate edge the AI confirmed independent — non-blocking
 */
export type EdgeType = "BLOCKS" | "TOUCHES" | "SEMANTIC" | "STACKED" | "INDIRECT" | "CO_LOCATED";

export type EdgeSeverity = "low" | "medium" | "high" | "critical";
export type EdgeEvidence = "patch" | "diff3" | "symbol" | "stack" | "transitive" | "unknown";
/** `exact` evidence is a fact (git WILL conflict); only `approx` edges may be demoted by the AI. */
export type Certainty = "exact" | "approx";

/** Phase-2 AI refinement verdict attached to an edge. */
export type SemanticVerdict = "TRUE_CONFLICT" | "CO_LOCATED" | "UNCERTAIN";
export type VerdictOrigin = "ai" | "cache" | "heuristic";

export interface PRFile {
  filename: string;
  additions: number;
  deletions: number;
  status?: string;
  /** Unified-diff hunks (GitHub omits this for binary / very large files). */
  patch?: string;
  /** Set for renamed files. */
  previousFilename?: string;
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
  headSha?: string;
  baseSha?: string;
  headRef?: string;
  baseRef?: string;
  draft?: boolean;
}

/** One conflicting (or co-located) stretch of base lines in a shared file. */
export interface ConflictRegion {
  /** First base line involved (1-based). */
  baseStart: number;
  /** Last base line involved; `baseEnd === baseStart - 1` marks a pure insertion point. */
  baseEnd: number;
  /** Up to 6 diff lines from the source PR ("-old" / "+new"). */
  aPreview: string[];
  /** Up to 6 diff lines from the target PR. */
  bPreview: string[];
}

export type FileConflictKind = "overlap" | "disjoint" | "unknown" | "regenerable";

export interface FileConflict {
  file: string;
  kind: FileConflictKind;
  method: "patch" | "diff3" | "none";
  regions: ConflictRegion[];
}

export type SymbolChange = "removed" | "renamed" | "signature";

export interface SymbolLink {
  name: string;
  change: SymbolChange;
  /** File where the source PR changes the definition. */
  defFile: string;
  /** File where the target PR adds a reference. */
  refFile: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  /** Files both PRs touch (empty for pure SEMANTIC / STACKED edges). */
  sharedFiles: string[];
  /** Does this edge hold the target back? Status, cycles and merge order use blocking edges only. */
  blocking: boolean;
  severity: EdgeSeverity;
  evidence: EdgeEvidence;
  certainty: Certainty;
  conflicts?: FileConflict[];
  symbols?: SymbolLink[];
  /** INDIRECT only: the blocking path source → … → target. */
  via?: string[];
  /** Set when the AI layer (or its heuristic fallback) has refined this edge. */
  semanticVerdict?: SemanticVerdict;
  explanation?: string;
  resolution?: string;
  confidence?: number;
  verdictOrigin?: VerdictOrigin;
}

export type CiState = "success" | "failure" | "pending" | "none";
export type ReviewState = "approved" | "changes_requested" | "review_required" | "none";
export type ReadinessState = "READY" | "WAITING" | "NOT_READY";

/** Merge readiness of one PR (CI, reviews, mergeability, draft, branch rules). */
export interface Readiness {
  ci: CiState;
  failingChecks: string[];
  pendingChecks: string[];
  review: ReviewState;
  mergeable: "clean" | "conflicting" | "unknown";
  draft: boolean;
  missingRequiredChecks: string[];
  state: ReadinessState;
  /** 0–100, higher = closer to mergeable. */
  score: number;
  reasons: string[];
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
  /** Sources of blocking in-edges. */
  blockedBy: string[];
  /** Targets of blocking out-edges. */
  blocking: string[];
  /** Sources of non-blocking in-edges (TOUCHES / CO_LOCATED) — why a PR is AT_RISK. */
  relatedTo?: string[];
  /** Upstream PRs reachable over blocking edges that are not direct blockers. */
  transitivelyBlockedBy?: string[];
  headSha?: string;
  headRef?: string;
  baseRef?: string;
  draft?: boolean;
  readiness?: Readiness;
  workspaces?: string[];
  /** 1-based merge-plan step, or null when parked. */
  planStep?: number | null;
}

export interface GraphNode {
  id: string;
  type: "prNode";
  position: { x: number; y: number };
  data: PRNodeData;
}

export interface MergeOrder {
  /** Kahn levels over blocking edges: level 0 = merge now, level 1 = after level 0, etc. */
  levels: string[][];
  /** Node ids that never reach in-degree 0 — they are in a cycle. */
  inCycle: string[];
  totalLevels: number;
}

export interface MergePlanStep {
  /** 1-based step number. */
  index: number;
  /** PRs that can be merged together in this step (mutually independent, all READY). */
  prs: string[];
  /** PRs that become unblocked once this step is merged. */
  unlocks: string[];
  rationale: string;
}

export interface ParkedPR {
  id: string;
  reasons: string[];
  /** Parked PRs this one is (transitively) waiting on. */
  waitingOn: string[];
}

export interface MergePlan {
  steps: MergePlanStep[];
  parked: ParkedPR[];
  /** Longest chain of blocking edges — the minimum number of sequential merges. */
  criticalPath: string[];
  totalSteps: number;
}

export interface GraphStats {
  totalPRs: number;
  safePRs: number;
  atRiskPRs: number;
  blockedPRs: number;
  deadlockedPRs: number;
  /** Every edge except INDIRECT. */
  totalDependencies: number;
  blockingDependencies: number;
}

export interface DependencyGraph {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  nodes: GraphNode[];
  edges: GraphEdge[];
  mergeOrder: MergeOrder;
  cycles: string[][];
  stats: GraphStats;
  mergePlan?: MergePlan;
}

/** Engine options — passed in (never read from env) so the engine stays pure. */
export interface EngineOptions {
  /** Extra regenerable globs (lockfiles etc. are built in). */
  ignoreGlobs?: string[];
  /** Workspace globs for monorepo grouping (`apps/*` style). */
  workspaceGlobs?: string[];
}
