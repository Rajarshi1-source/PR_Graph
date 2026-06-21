"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { GitPullRequest } from "lucide-react";
import type { PRNodeData } from "@/lib/graph/types";
import { statusMeta } from "./statusMeta";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type PRFlowNode = Node<PRNodeData, "prNode">;

function PRNodeImpl({ data, selected }: NodeProps<PRFlowNode>) {
  const meta = statusMeta[data.status];
  const Icon = meta.icon;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`PR #${data.prNumber}: ${data.title}. Status: ${meta.label}. ${data.blockedBy.length} blocking, ${data.blocking.length} blocked.`}
      className={cn(
        "bg-card text-card-foreground w-[280px] rounded-xl border-l-4 border border-border shadow-sm transition-shadow",
        "hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        meta.border,
        selected && "ring-2 ring-ring",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />

      <div className="flex items-start gap-3 p-3">
        <Avatar className="size-8 shrink-0">
          <AvatarImage src={data.authorAvatar} alt={data.author} />
          <AvatarFallback>{data.author.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <GitPullRequest className="size-3.5" aria-hidden />
            <span>#{data.prNumber}</span>
            <span className="truncate">· {data.author}</span>
          </div>
          <p className="truncate text-sm font-medium" title={data.title}>
            {data.title}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between px-3 pb-3">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
            meta.chip,
          )}
        >
          <Icon className="size-3" aria-hidden />
          {meta.short}
        </span>

        <div className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums">
          <span title="files changed">{data.filesChanged}f</span>
          <span className="text-status-safe" title="additions">
            +{data.additions}
          </span>
          <span className="text-status-deadlocked" title="deletions">
            −{data.deletions}
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
}

export const PRNode = memo(PRNodeImpl);
