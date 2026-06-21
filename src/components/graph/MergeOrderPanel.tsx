"use client";

import { CircleX } from "lucide-react";
import type { DependencyGraph } from "@/lib/graph/types";
import { cn } from "@/lib/utils";

/**
 * Surfaces the topological merge order (Kahn levels) — the core product promise. Level 0 is
 * "merge now"; each subsequent level becomes mergeable once the previous one lands.
 */
export function MergeOrderPanel({ graph }: { graph: DependencyGraph }) {
  const { levels, inCycle } = graph.mergeOrder;
  const titleFor = (id: string) => graph.nodes.find((n) => n.id === id)?.data.title ?? "";

  if (!levels.length && !inCycle.length) return null;

  return (
    <div className="bg-card/95 text-card-foreground max-h-[60vh] w-64 overflow-auto rounded-lg border p-3 text-xs shadow-sm backdrop-blur">
      <p className="mb-2 font-semibold">Merge order</p>
      <ol className="space-y-2">
        {levels.map((ids, i) => (
          <li key={i}>
            <p className="text-muted-foreground mb-1 font-medium">
              {i === 0 ? "Merge now" : `Step ${i + 1}`}
            </p>
            <ul className="space-y-0.5">
              {ids.map((id) => (
                <li key={id} className="truncate" title={`#${id} ${titleFor(id)}`}>
                  <span className={cn("font-medium", i === 0 && "text-status-safe")}>#{id}</span>{" "}
                  <span className="text-muted-foreground">{titleFor(id)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {inCycle.length > 0 && (
          <li>
            <p className="text-status-deadlocked mb-1 flex items-center gap-1 font-medium">
              <CircleX className="size-3.5" aria-hidden /> Deadlocked
            </p>
            <ul className="space-y-0.5">
              {inCycle.map((id) => (
                <li key={id} className="text-muted-foreground truncate" title={`#${id}`}>
                  #{id} {titleFor(id)}
                </li>
              ))}
            </ul>
          </li>
        )}
      </ol>
    </div>
  );
}
