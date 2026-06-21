import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps, type Edge } from "@xyflow/react";
import type { EdgeType } from "@/lib/graph/types";
import { edgeColor, edgeLabel } from "./statusMeta";

export interface DependencyEdgeData extends Record<string, unknown> {
  edgeType: EdgeType;
  sharedFiles: string[];
}

export type DependencyFlowEdge = Edge<DependencyEdgeData, "dependency">;

/**
 * Custom edge: maps overlap severity to stroke width + dash (frontend skill "Edge styling").
 *   CRITICAL_BLOCK -> thick solid, BLOCKS -> medium solid, TOUCHES/CO_LOCATED -> thin dashed.
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
  const type = data?.edgeType ?? "BLOCKS";
  const shared = data?.sharedFiles ?? [];
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const color = edgeColor[type];
  const width = type === "CRITICAL_BLOCK" ? 3 : type === "BLOCKS" ? 2 : 1.5;
  const dash = type === "TOUCHES" || type === "CO_LOCATED" ? "6 4" : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: color, strokeWidth: width, strokeDasharray: dash }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="bg-background/80 text-muted-foreground pointer-events-none absolute rounded px-1 text-[10px]"
        >
          {edgeLabel[type]}
          {shared.length ? ` ·${shared.length}` : ""}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
