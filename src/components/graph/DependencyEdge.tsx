"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps, type Edge } from "@xyflow/react";
import { Braces, Sparkles } from "lucide-react";
import type { GraphEdge } from "@/lib/graph/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { edgeMeta, edgeStroke } from "./statusMeta";

export interface DependencyEdgeData extends Record<string, unknown> {
  edge: GraphEdge;
  /** Faded when a filter / what-if focus excludes this edge. */
  dimmed?: boolean;
}

export type DependencyFlowEdge = Edge<DependencyEdgeData, "dependency">;

/** Short label: "blocks · 2 lines", "uses getUser()", "touches · 1 file", … */
export function edgeShortLabel(e: GraphEdge): string {
  if (e.type === "SEMANTIC" && e.symbols?.length) {
    const s = e.symbols[0];
    return `uses ${s.name}()${e.symbols.length > 1 ? ` +${e.symbols.length - 1}` : ""}`;
  }
  if (e.type === "BLOCKS") {
    const regions = (e.conflicts ?? []).filter((c) => c.kind === "overlap").flatMap((c) => c.regions);
    const lines = regions.reduce((n, r) => n + Math.max(1, r.baseEnd - r.baseStart + 1), 0);
    if (lines) return `blocks · ${lines} line${lines === 1 ? "" : "s"}`;
    return `blocks · ${e.sharedFiles.length} file${e.sharedFiles.length === 1 ? "" : "s"}`;
  }
  if (e.type === "TOUCHES" || e.type === "CO_LOCATED")
    return `${edgeMeta[e.type].label} · ${e.sharedFiles.length} file${e.sharedFiles.length === 1 ? "" : "s"}`;
  return edgeMeta[e.type].label;
}

/**
 * Custom edge: type → token colour + dash, severity → width, approximate evidence → dashed. The
 * label is a focusable button whose tooltip explains the edge (evidence, AI verdict, resolution).
 */
export function DependencyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<DependencyFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  if (!data) return <BaseEdge id={id} path={path} markerEnd={markerEnd} />;

  const e = data.edge;
  const stroke = edgeStroke(e);
  const label = edgeShortLabel(e);
  const aiTagged = e.semanticVerdict && e.verdictOrigin !== "heuristic";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: stroke.color,
          strokeWidth: stroke.width,
          strokeDasharray: stroke.dash,
          opacity: data.dimmed ? 0.15 : 1,
        }}
      />
      {e.type !== "INDIRECT" && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn("nodrag nopan pointer-events-auto absolute", data.dimmed && "opacity-20")}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Dependency #${e.source} to #${e.target}: ${label}`}
                    className="bg-background/90 text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-1 rounded border px-1 text-[10px] leading-4 focus-visible:ring-2 focus-visible:outline-none"
                  />
                }
              >
                {e.type === "SEMANTIC" && <Braces className="size-2.5" aria-hidden />}
                {aiTagged && <Sparkles className="size-2.5" aria-hidden />}
                {label}
              </TooltipTrigger>
              <TooltipContent className="block max-w-sm space-y-1 text-left">
                <EdgeExplanation edge={e} />
              </TooltipContent>
            </Tooltip>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const ORIGIN_LABEL = { ai: "AI", cache: "AI (cached)", heuristic: "heuristic" } as const;

/** Plain-English explanation of an edge — shared by the tooltip and the PR detail panel. */
export function EdgeExplanation({ edge: e }: { edge: GraphEdge }) {
  return (
    <>
      <p className="font-medium">
        #{e.source} → #{e.target}: {edgeMeta[e.type].description}
      </p>
      <p className="opacity-80">
        {e.blocking ? "Blocking" : "Non-blocking"} · {e.severity} · evidence: {e.evidence}
        {e.certainty === "approx" ? " (approximate)" : ""}
      </p>
      {e.symbols?.slice(0, 3).map((s) => (
        <p key={`${s.name}-${s.refFile}`} className="opacity-90">
          #{e.source} {s.change} <code>{s.name}</code> ({s.defFile}); #{e.target} uses it in {s.refFile}
        </p>
      ))}
      {e.semanticVerdict && (
        <p>
          <span className="font-medium">
            {e.verdictOrigin ? ORIGIN_LABEL[e.verdictOrigin] : "Analysis"}: {e.semanticVerdict.replace("_", " ").toLowerCase()}
            {typeof e.confidence === "number" ? ` (${Math.round(e.confidence * 100)}%)` : ""}
          </span>
          {e.explanation ? ` — ${e.explanation}` : ""}
        </p>
      )}
      {e.resolution && <p className="opacity-90">Suggested: {e.resolution}</p>}
    </>
  );
}
