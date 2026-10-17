import type { DependencyGraph, GraphEdge, VerdictOrigin } from "./types";
import type { ConflictVerdict } from "@/lib/ai/types";
import { deriveGraph } from "./derive";

export type RefineVerdict = ConflictVerdict & { source?: VerdictOrigin };

/**
 * Pure AI-refinement stage. Rules (prgraph-graph-ai §Layer 2):
 *   - every analysed edge is annotated (verdict, confidence, explanation, resolution, origin);
 *   - only APPROXIMATE blocking evidence may be demoted: CO_LOCATED → non-blocking CO_LOCATED edge;
 *   - exact textual conflicts and stacks are facts — annotated, never demoted;
 *   - the AI never adds a blocking edge: TRUE_CONFLICT on a TOUCHES edge stays non-blocking (the
 *     target shows AT_RISK with the explanation).
 * Then status / cycles / merge order / stats are re-derived. Same inputs ⇒ same output.
 */
export function refineGraph(
  graph: DependencyGraph,
  verdicts: Map<string, RefineVerdict>,
): DependencyGraph {
  const edges: GraphEdge[] = graph.edges
    .filter((e) => e.type !== "INDIRECT")
    .map((e) => {
      const v = verdicts.get(e.id);
      if (!v) return { ...e };
      const refined: GraphEdge = {
        ...e,
        semanticVerdict: v.verdict,
        explanation: v.explanation,
        confidence: v.confidence,
        ...(v.resolution ? { resolution: v.resolution } : {}),
        ...(v.source ? { verdictOrigin: v.source } : {}),
      };
      if (canDemote(e) && v.verdict === "CO_LOCATED") {
        refined.type = "CO_LOCATED";
        refined.blocking = false;
        refined.severity = "low";
      }
      return refined;
    });

  return deriveGraph(graph.nodes, edges, graph.mergePlan);
}

/** Only approximate blocking evidence (no patch, base drift, regex symbol match) may be demoted. */
export function canDemote(e: GraphEdge): boolean {
  return e.blocking && e.certainty === "approx" && (e.type === "BLOCKS" || e.type === "SEMANTIC");
}

/** Edges worth sending to the analyzer: anything with shared files or symbol links. */
export function analyzableEdges(graph: DependencyGraph): GraphEdge[] {
  return graph.edges.filter(
    (e) =>
      e.type !== "INDIRECT" &&
      e.type !== "STACKED" &&
      (e.sharedFiles.length > 0 || (e.symbols?.length ?? 0) > 0),
  );
}
