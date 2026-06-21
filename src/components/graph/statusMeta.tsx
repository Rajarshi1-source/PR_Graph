import { CircleCheck, TriangleAlert, CircleX, type LucideIcon } from "lucide-react";
import type { NodeStatus, EdgeType } from "@/lib/graph/types";

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
    icon: CircleX,
    text: "text-status-deadlocked",
    chip: "bg-status-deadlocked-bg text-status-deadlocked border-status-deadlocked/40",
    border: "border-status-deadlocked",
    dot: "bg-status-deadlocked",
  },
};

/** Edge stroke colour by severity (uses CSS custom props so it follows the theme). */
export const edgeColor: Record<EdgeType, string> = {
  TOUCHES: "var(--edge-touches)",
  BLOCKS: "var(--edge-blocks)",
  CRITICAL_BLOCK: "var(--edge-critical)",
  CO_LOCATED: "var(--edge-touches)",
};

export const edgeLabel: Record<EdgeType, string> = {
  TOUCHES: "touches",
  BLOCKS: "blocks",
  CRITICAL_BLOCK: "critical",
  CO_LOCATED: "co-located",
};
