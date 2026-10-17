"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  GitPullRequest,
  CircleCheck,
  CircleX,
  Clock,
  UserCheck,
  MessageSquareWarning,
  FilePen,
  Layers,
} from "lucide-react";
import type { PRNodeData, Readiness } from "@/lib/graph/types";
import { statusMeta } from "./statusMeta";
import { useNodeActivate } from "./activate";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/** Flow-only presentation flags layered on the shared DTO (never persisted). */
export type FlowNodeData = PRNodeData & {
  /** Merged in the current what-if simulation. */
  ghost?: boolean;
  /** Filtered out by the workspace lens. */
  dimmed?: boolean;
  /** On the merge plan's critical path (when highlighted). */
  critical?: boolean;
};

type PRFlowNode = Node<FlowNodeData, "prNode">;

const CI = {
  success: { icon: CircleCheck, cls: "text-status-safe", label: "CI passing" },
  failure: { icon: CircleX, cls: "text-status-blocked", label: "CI failing" },
  pending: { icon: Clock, cls: "text-status-at-risk", label: "CI running" },
} as const;

/** CI + review chips: icon + screen-reader text (status is never colour-only). */
export function ReadinessChips({ readiness, className }: { readiness?: Readiness; className?: string }) {
  if (!readiness) return null;
  const ci = readiness.ci !== "none" ? CI[readiness.ci] : null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {ci && (
        <span title={readiness.failingChecks.length ? `${ci.label}: ${readiness.failingChecks.join(", ")}` : ci.label}>
          <ci.icon className={cn("size-3.5", ci.cls)} aria-hidden />
          <span className="sr-only">{ci.label}</span>
        </span>
      )}
      {readiness.review === "approved" && (
        <span title="Approved">
          <UserCheck className="text-status-safe size-3.5" aria-hidden />
          <span className="sr-only">Approved</span>
        </span>
      )}
      {readiness.review === "changes_requested" && (
        <span title="Changes requested">
          <MessageSquareWarning className="text-status-blocked size-3.5" aria-hidden />
          <span className="sr-only">Changes requested</span>
        </span>
      )}
      {readiness.draft && (
        <span title="Draft">
          <FilePen className="text-muted-foreground size-3.5" aria-hidden />
          <span className="sr-only">Draft</span>
        </span>
      )}
    </span>
  );
}

function PRNodeImpl({ data, selected }: NodeProps<PRFlowNode>) {
  const meta = statusMeta[data.status];
  const Icon = meta.icon;
  const activate = useNodeActivate();
  const stepLabel = data.planStep ? `merge step ${data.planStep}` : data.readiness ? "parked" : "";

  return (
    <div
      className={cn(
        "bg-card text-card-foreground relative w-[280px] rounded-xl border-l-4 border border-border shadow-sm transition-[box-shadow,opacity]",
        "hover:shadow-md has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring",
        meta.border,
        selected && "ring-2 ring-ring",
        data.critical && !selected && "ring-2 ring-primary/70",
        data.ghost && "border-dashed opacity-40",
        data.dimmed && "opacity-25",
      )}
    >
      {/* The whole card is one native button (keyboard + screen readers); the visual content below
          is aria-hidden so its text never conflicts with this summary label. */}
      <button
        type="button"
        onClick={() => activate(data)}
        aria-label={`PR #${data.prNumber}: ${data.title}. Status: ${meta.label}. ${data.blockedBy.length} blockers, blocking ${data.blocking.length}.${stepLabel ? ` ${stepLabel}.` : ""}${data.ghost ? " Simulated as merged." : ""}`}
        className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none"
      />
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />

      <div aria-hidden className="flex items-start gap-3 p-3">
        <Avatar className="size-8 shrink-0">
          <AvatarImage src={data.authorAvatar} alt={data.author} />
          <AvatarFallback>{data.author.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <GitPullRequest className="size-3.5" aria-hidden />
            <span>#{data.prNumber}</span>
            <span className="truncate">· {data.author}</span>
            {data.baseRef && data.baseRef !== "main" && data.baseRef !== "master" && (
              <span title={`Stacked on ${data.baseRef}`} className="ml-auto shrink-0">
                <Layers className="size-3.5" aria-hidden />
                <span className="sr-only">Stacked on {data.baseRef}</span>
              </span>
            )}
          </div>
          <p className="truncate text-sm font-medium" title={data.title}>
            {data.title}
          </p>
        </div>
      </div>

      <div aria-hidden className="flex items-center justify-between gap-2 px-3 pb-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              meta.chip,
            )}
          >
            <Icon className="size-3" aria-hidden />
            {data.ghost ? "Merged (sim)" : meta.short}
          </span>
          <ReadinessChips readiness={data.readiness} />
          {data.planStep ? (
            <span className="text-muted-foreground rounded border px-1 text-[10px] tabular-nums" title={`Merge plan step ${data.planStep}`}>
              S{data.planStep}
            </span>
          ) : null}
        </span>

        <div className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs tabular-nums">
          <span title="files changed">{data.filesChanged}f</span>
          <span className="text-status-safe" title="additions">
            +{data.additions}
          </span>
          <span className="text-status-blocked" title="deletions">
            −{data.deletions}
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
}

export const PRNode = memo(PRNodeImpl);
