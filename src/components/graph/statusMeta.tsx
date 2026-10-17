import {
  CircleCheck,
  CircleAlert,
  TriangleAlert,
  Lock,
  type LucideIcon,
} from "lucide-react";
import type { NodeStatus, EdgeType, GraphEdge } from "@/lib/graph/types";

/** Status presentation — colour is always paired with a label + icon (colour-blind safe). */
export const statusMeta: Record<
  NodeStatus,
  { label: string; short: string; icon: LucideIcon; text: string; chip: string; border: string; dot: string }
> = {
  SAFE: {
    label: "Safe to merge",
    short: "Safe",
    icon: CircleCheck,
    text: "text-status-safe",
    chip: "bg-status-safe-bg text-status-safe border-status-safe/40",
    border: "border-status-safe",
    dot: "bg-status-safe",
  },
  AT_RISK: {
    label: "Has dependencies",
    short: "At risk",
    icon: CircleAlert,
    text: "text-status-at-risk",
    chip: "bg-status-at-risk-bg text-status-at-risk border-status-at-risk/50",
    border: "border-status-at-risk",
    dot: "bg-status-at-risk",
  },
  BLOCKED: {
    label: "Blocked",
    short: "Blocked",
    icon: TriangleAlert,
    text: "text-status-blocked",
    chip: "bg-status-blocked-bg text-status-blocked border-status-blocked/40",
    border: "border-status-blocked",
    dot: "bg-status-blocked",
  },
  DEADLOCKED: {
    label: "Deadlocked (cycle)",
    short: "Deadlocked",
    icon: Lock,
    text: "text-status-deadlocked",
    chip: "bg-status-deadlocked-bg text-status-deadlocked border-status-deadlocked/40",
    border: "border-status-deadlocked",
    dot: "bg-status-deadlocked",
  },
};

export const STATUS_ORDER: NodeStatus[] = ["SAFE", "AT_RISK", "BLOCKED", "DEADLOCKED"];

/** Edge presentation per type: theme-aware stroke token + dash pattern + label (never colour alone). */
export const edgeMeta: Record<
  EdgeType,
  { label: string; color: string; dash?: string; width: number; description: string }
> = {
  BLOCKS: {
    label: "blocks",
    color: "var(--edge-blocks)",
    width: 2,
    description: "Overlapping lines — git will conflict",
  },
  TOUCHES: {
    label: "touches",
    color: "var(--edge-touches)",
    dash: "5 5",
    width: 1.5,
    description: "Same file, disjoint lines — merges cleanly",
  },
  SEMANTIC: {
    label: "uses symbol",
    color: "var(--edge-semantic)",
    width: 2,
    description: "Changes a symbol the other PR uses",
  },
  STACKED: {
    label: "stacked",
    color: "var(--edge-stacked)",
    width: 2,
    description: "Built on top of the other PR's branch",
  },
  INDIRECT: {
    label: "indirect",
    color: "var(--edge-indirect)",
    dash: "2 4",
    width: 1,
    description: "Transitive dependency",
  },
  CO_LOCATED: {
    label: "co-located",
    color: "var(--edge-touches)",
    dash: "5 5",
    width: 1,
    description: "AI-confirmed independent",
  },
};

export const EDGE_ORDER: EdgeType[] = ["BLOCKS", "SEMANTIC", "STACKED", "TOUCHES", "CO_LOCATED", "INDIRECT"];

/** Concrete stroke for one edge: critical BLOCKS are thicker/darker, approximate ones are dashed. */
export function edgeStroke(e: Pick<GraphEdge, "type" | "severity" | "certainty" | "blocking">): {
  color: string;
  width: number;
  dash?: string;
} {
  const meta = edgeMeta[e.type];
  if (e.type === "BLOCKS" && e.severity === "critical")
    return { color: "var(--edge-critical)", width: 3, dash: e.certainty === "approx" ? "6 3" : undefined };
  if (e.blocking && e.certainty === "approx" && !meta.dash) return { ...meta, dash: "6 3" };
  return { color: meta.color, width: meta.width, dash: meta.dash };
}
