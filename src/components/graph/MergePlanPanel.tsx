"use client";

import { useState } from "react";
import { Copy, Lock, Route } from "lucide-react";
import { toast } from "sonner";
import type { DependencyGraph } from "@/lib/graph/types";
import { planMerges, planToMarkdown } from "@/lib/graph/mergePlan";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReadinessChips } from "./PRNode";

/**
 * The merge plan (Feature C): readiness-aware steps of independent PRs, parked PRs with reasons,
 * and the critical path — with Kahn levels as a secondary view.
 */
export function MergePlanPanel({
  graph,
  repoName,
  onSelect,
  highlightCritical,
  onToggleCritical,
}: {
  graph: DependencyGraph;
  repoName: string;
  onSelect: (id: string) => void;
  highlightCritical: boolean;
  onToggleCritical: () => void;
}) {
  const [tab, setTab] = useState<"plan" | "levels">("plan");
  const plan = graph.mergePlan ?? planMerges(graph);
  const node = (id: string) => graph.nodes.find((n) => n.id === id)?.data;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(planToMarkdown(plan, graph, repoName));
      toast.success("Merge plan copied as Markdown");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const Chip = ({ id }: { id: string }) => (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className="hover:bg-muted focus-visible:ring-ring flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="font-medium">#{id}</span>
      <span className="text-muted-foreground truncate">{node(id)?.title}</span>
      <ReadinessChips readiness={node(id)?.readiness} className="ml-auto shrink-0" />
    </button>
  );

  return (
    <section
      aria-label="Merge plan"
      className="bg-card/95 text-card-foreground flex max-h-[60vh] w-72 flex-col rounded-lg border text-xs shadow-sm backdrop-blur"
    >
      <div className="flex items-center gap-1 border-b p-2">
        {(["plan", "levels"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded px-2 py-0.5 font-medium",
              tab === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "plan" ? "Merge plan" : "Levels"}
          </button>
        ))}
        <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Copy merge plan as Markdown" onClick={copy}>
          <Copy className="size-3.5" />
        </Button>
      </div>

      <div className="overflow-auto p-3">
        {tab === "plan" ? (
          <>
            {plan.steps.length === 0 && <p className="text-muted-foreground">Nothing is ready to merge yet.</p>}
            <ol className="space-y-3">
              {plan.steps.map((s) => (
                <li key={s.index}>
                  <p className="text-muted-foreground mb-1 font-medium">
                    {s.index === 1 ? "Merge now" : `Step ${s.index}`}
                    {s.prs.length > 1 && <span className="font-normal"> · in parallel</span>}
                  </p>
                  <ul className="space-y-0.5">
                    {s.prs.map((id) => (
                      <li key={id}>
                        <Chip id={id} />
                      </li>
                    ))}
                  </ul>
                  {s.unlocks.length > 0 && (
                    <p className="text-muted-foreground mt-0.5">Unblocks {s.unlocks.map((u) => `#${u}`).join(", ")}</p>
                  )}
                </li>
              ))}
            </ol>
            {plan.parked.length > 0 && (
              <div className="mt-3">
                <p className="text-muted-foreground mb-1 font-medium">Parked ({plan.parked.length})</p>
                <ul className="space-y-1.5">
                  {plan.parked.map((p) => (
                    <li key={p.id}>
                      <Chip id={p.id} />
                      <p className="text-muted-foreground pl-1">{p.reasons.join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.criticalPath.length > 1 && (
              <button
                type="button"
                aria-pressed={highlightCritical}
                onClick={onToggleCritical}
                className="text-muted-foreground hover:text-foreground mt-3 flex items-center gap-1"
              >
                <Route className="size-3.5" aria-hidden />
                Critical path: {plan.criticalPath.map((id) => `#${id}`).join(" → ")}
                <span className="sr-only">{highlightCritical ? "(highlighted)" : "(click to highlight)"}</span>
              </button>
            )}
          </>
        ) : (
          <ol className="space-y-2">
            {graph.mergeOrder.levels.map((ids, i) => (
              <li key={i}>
                <p className="text-muted-foreground mb-1 font-medium">{i === 0 ? "Level 0 (no blockers)" : `Level ${i}`}</p>
                <ul className="space-y-0.5">
                  {ids.map((id) => (
                    <li key={id}>
                      <Chip id={id} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {graph.mergeOrder.inCycle.length > 0 && (
              <li>
                <p className="text-status-deadlocked mb-1 flex items-center gap-1 font-medium">
                  <Lock className="size-3.5" aria-hidden /> Deadlocked
                </p>
                <ul className="space-y-0.5">
                  {graph.mergeOrder.inCycle.map((id) => (
                    <li key={id}>
                      <Chip id={id} />
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ol>
        )}
      </div>
    </section>
  );
}
