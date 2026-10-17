import { diff3Merge } from "node-diff3";
import type { ConflictRegion, DependencyGraph, EdgeSeverity, FileConflict, GraphEdge } from "./types";
import { deriveGraph } from "./derive";

/** Contents needed to replay "merge A, then merge B" for one file (null = file absent at that ref). */
export interface SequentialMergeInput {
  mergeBaseA: string | null;
  headA: string | null;
  mergeBaseB: string | null;
  headB: string | null;
  baseTip: string | null;
}

export type DeepOutcome =
  | { status: "clean" }
  | { status: "conflict"; regions: ConflictRegion[] }
  /** A conflicts with the base branch itself, so the pair cannot be simulated. */
  | { status: "unknown" };

const lines = (s: string | null) => (s === null || s === "" ? [] : s.split(/\r?\n/));
const MAX_PREVIEW = 6;

/**
 * Tier-2 deep verify, pure: replay git's sequential merge with diff3.
 *   1. merge PR A onto the current base tip (ancestor = A's merge base);
 *   2. merge PR B onto that result (ancestor = B's merge base) — any conflict here is a real
 *      PR-vs-PR conflict, reported in B's merge-base line coordinates.
 */
export function simulateSequentialMerge(input: SequentialMergeInput): DeepOutcome {
  const tip = lines(input.baseTip);
  const step1 = diff3Merge(lines(input.headA), lines(input.mergeBaseA), tip);
  if (step1.some((r) => "conflict" in r)) return { status: "unknown" };
  const mergedA = step1.flatMap((r) => ("ok" in r && r.ok ? r.ok : []));

  const baseB = lines(input.mergeBaseB);
  const step2 = diff3Merge(mergedA, baseB, lines(input.headB));
  const regions: ConflictRegion[] = [];
  for (const r of step2) {
    if (!("conflict" in r) || !r.conflict) continue;
    const c = r.conflict;
    const start = c.oIndex + 1;
    regions.push({
      baseStart: start,
      baseEnd: start + c.o.length - 1,
      aPreview: c.a.slice(0, MAX_PREVIEW).map((l) => `+${l}`),
      bPreview: c.b.slice(0, MAX_PREVIEW).map((l) => `+${l}`),
    });
  }
  return regions.length ? { status: "conflict", regions } : { status: "clean" };
}

/** Per edge: file → deep outcome. */
export type DeepResults = Map<string, Map<string, DeepOutcome>>;

const SEVERITY: EdgeSeverity[] = ["low", "medium", "high", "critical"];

/**
 * Fold deep-verify outcomes into the graph (pure). Verified files become exact (`method: "diff3"`);
 * an edge whose blocking signal is now fully verified becomes `certainty: "exact"`, and a verified
 * clean merge turns an approximate BLOCKS into a non-blocking TOUCHES.
 */
export function applyDeepVerdicts(graph: DependencyGraph, results: DeepResults): DependencyGraph {
  if (results.size === 0) return graph;
  const edges = graph.edges
    .filter((e) => e.type !== "INDIRECT")
    .map((e) => {
      const perFile = results.get(e.id);
      if (!perFile || !e.conflicts) return e;
      const conflicts: FileConflict[] = e.conflicts.map((c) => {
        const o = perFile.get(c.file);
        if (!o || o.status === "unknown") return c;
        return o.status === "clean"
          ? { ...c, kind: "disjoint", method: "diff3", regions: [] }
          : { ...c, kind: "overlap", method: "diff3", regions: o.regions };
      });
      return reclassify(e, conflicts);
    });
  return deriveGraph(graph.nodes, edges, graph.mergePlan);
}

function reclassify(e: GraphEdge, conflicts: FileConflict[]): GraphEdge {
  const overlap = conflicts.filter((c) => c.kind === "overlap").length;
  const unknown = conflicts.filter((c) => c.kind === "unknown").length;
  const fileBlocking = overlap + unknown > 0;
  const allVerified = conflicts.every((c) => c.kind === "regenerable" || c.method === "diff3");
  const next: GraphEdge = { ...e, conflicts };

  if (e.type === "STACKED") return next; // stacks block regardless of file content
  if (e.type === "SEMANTIC" && !fileBlocking) return next;

  next.type = fileBlocking ? "BLOCKS" : "TOUCHES";
  next.blocking = fileBlocking || (e.symbols?.length ?? 0) > 0;
  if (!fileBlocking && next.blocking) next.type = "SEMANTIC";
  next.evidence = conflicts.some((c) => c.method === "diff3") ? "diff3" : e.evidence;
  next.certainty = unknown === 0 && allVerified && next.type !== "SEMANTIC" ? "exact" : e.certainty;
  next.severity = !next.blocking
    ? "low"
    : next.type === "SEMANTIC"
      ? "high"
      : SEVERITY[Math.min(3, Math.max(1, overlap))];
  return next;
}

/** Edges worth a deep verify: approximate, with at least one non-regenerable shared file. */
export function deepCandidates(graph: DependencyGraph, max: number): GraphEdge[] {
  const rank = (e: GraphEdge) => (e.blocking ? 0 : 1) * 10 + (3 - SEVERITY.indexOf(e.severity));
  return graph.edges
    .filter(
      (e) =>
        e.type !== "INDIRECT" &&
        e.type !== "CO_LOCATED" &&
        e.certainty === "approx" &&
        (e.conflicts ?? []).some((c) => c.kind !== "regenerable"),
    )
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
    .slice(0, max);
}
