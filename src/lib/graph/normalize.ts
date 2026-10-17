import {
  GRAPH_SCHEMA_VERSION,
  type DependencyGraph,
  type EdgeSeverity,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type NodeStatus,
} from "./types";

const STATUSES: ReadonlySet<string> = new Set<NodeStatus>(["SAFE", "AT_RISK", "BLOCKED", "DEADLOCKED"]);
const TYPES: ReadonlySet<string> = new Set<EdgeType>([
  "BLOCKS",
  "TOUCHES",
  "SEMANTIC",
  "STACKED",
  "INDIRECT",
  "CO_LOCATED",
]);

type Loose = Record<string, unknown>;

/**
 * Upgrade any stored graph payload (v1 snapshot, Redis cache entry, socket message) to schema v2.
 * Pure and idempotent: a v2 graph passes through with defaults filled in. Returns null for
 * payloads that are not graphs at all.
 *
 * v1 → v2: `CRITICAL_BLOCK` → BLOCKS + severity critical; `blocking` derived from the type
 * (v1 treated every edge except CO_LOCATED as blocking); evidence unknown / certainty approx
 * (v1 never looked at lines); stats gain atRiskPRs + blockingDependencies.
 */
export function normalizeGraph(input: unknown): DependencyGraph | null {
  if (!input || typeof input !== "object") return null;
  const g = input as Loose;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;

  const nodes = (g.nodes as Loose[]).map(normalizeNode);
  const edges = (g.edges as Loose[]).map(normalizeEdge);
  const nonIndirect = edges.filter((e) => e.type !== "INDIRECT");
  const count = (s: NodeStatus) => nodes.filter((n) => n.data.status === s).length;
  const stats = (g.stats ?? {}) as Loose;
  const mergeOrder = (g.mergeOrder ?? {}) as Loose;

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes,
    edges,
    mergeOrder: {
      levels: Array.isArray(mergeOrder.levels) ? (mergeOrder.levels as string[][]) : [],
      inCycle: Array.isArray(mergeOrder.inCycle) ? (mergeOrder.inCycle as string[]) : [],
      totalLevels: typeof mergeOrder.totalLevels === "number" ? mergeOrder.totalLevels : 0,
    },
    cycles: Array.isArray(g.cycles) ? (g.cycles as string[][]) : [],
    stats: {
      totalPRs: num(stats.totalPRs, nodes.length),
      safePRs: num(stats.safePRs, count("SAFE")),
      atRiskPRs: num(stats.atRiskPRs, count("AT_RISK")),
      blockedPRs: num(stats.blockedPRs, count("BLOCKED")),
      deadlockedPRs: num(stats.deadlockedPRs, count("DEADLOCKED")),
      totalDependencies: num(stats.totalDependencies, nonIndirect.length),
      blockingDependencies: num(stats.blockingDependencies, nonIndirect.filter((e) => e.blocking).length),
    },
    ...(g.mergePlan && typeof g.mergePlan === "object"
      ? { mergePlan: g.mergePlan as DependencyGraph["mergePlan"] }
      : {}),
  };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

function normalizeNode(n: Loose): GraphNode {
  const data = (n.data ?? {}) as Loose;
  const status = STATUSES.has(String(data.status)) ? (data.status as NodeStatus) : "SAFE";
  return {
    id: String(n.id),
    type: "prNode",
    position: (n.position as GraphNode["position"]) ?? { x: 0, y: 0 },
    data: {
      ...(data as GraphNode["data"]),
      status,
      blockedBy: Array.isArray(data.blockedBy) ? (data.blockedBy as string[]) : [],
      blocking: Array.isArray(data.blocking) ? (data.blocking as string[]) : [],
    },
  };
}

function normalizeEdge(e: Loose): GraphEdge {
  const rawType = String(e.type);
  const sharedFiles = Array.isArray(e.sharedFiles) ? (e.sharedFiles as string[]) : [];
  const legacyCritical = rawType === "CRITICAL_BLOCK";
  const type: EdgeType = legacyCritical ? "BLOCKS" : TYPES.has(rawType) ? (rawType as EdgeType) : "BLOCKS";
  const isV2 = typeof e.blocking === "boolean";
  const blocking = isV2 ? (e.blocking as boolean) : !(type === "CO_LOCATED" || type === "INDIRECT");
  const severity: EdgeSeverity = isSeverity(e.severity)
    ? e.severity
    : legacyCritical
      ? "critical"
      : !blocking
        ? "low"
        : sharedFiles.length >= 2
          ? "high"
          : "medium";
  return {
    ...(e as unknown as GraphEdge),
    id: String(e.id),
    source: String(e.source),
    target: String(e.target),
    type,
    sharedFiles,
    blocking,
    severity,
    evidence: (e.evidence as GraphEdge["evidence"]) ?? "unknown",
    certainty: (e.certainty as GraphEdge["certainty"]) ?? "approx",
  };
}

function isSeverity(v: unknown): v is EdgeSeverity {
  return v === "low" || v === "medium" || v === "high" || v === "critical";
}
