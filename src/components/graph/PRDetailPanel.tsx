"use client";

import { ExternalLink, FlaskConical, Sparkles } from "lucide-react";
import type { DependencyGraph, GraphEdge, PRNodeData } from "@/lib/graph/types";
import { statusMeta, edgeMeta } from "./statusMeta";
import { ConflictRegions } from "./ConflictRegions";
import { ReadinessChips } from "./PRNode";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const ORIGIN = { ai: "AI says", cache: "AI says (cached)", heuristic: "Heuristic" } as const;

function titleOf(graph: DependencyGraph, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.data.title ?? "";
}

export function PRDetailPanel({
  node,
  graph,
  open,
  onOpenChange,
  onSimulate,
  simulated,
}: {
  node: PRNodeData | null;
  graph: DependencyGraph;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Toggle this PR in the what-if merge simulation. */
  onSimulate?: (id: string) => void;
  simulated?: boolean;
}) {
  // Always read the freshest copy of the node (statuses change under an open panel).
  const live = node ? (graph.nodes.find((n) => n.id === String(node.prNumber))?.data ?? node) : null;
  const id = live ? String(live.prNumber) : "";
  const incoming = graph.edges.filter((e) => e.target === id && e.type !== "INDIRECT");
  const outgoing = graph.edges.filter((e) => e.source === id && e.type !== "INDIRECT");
  const parked = graph.mergePlan?.parked.find((p) => p.id === id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {live && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", statusMeta[live.status].dot)} />
                PR #{live.prNumber}
              </SheetTitle>
              <SheetDescription className="text-foreground text-base font-medium">{live.title}</SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6 text-sm">
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>by {live.author}</span>
                <span>{live.filesChanged} files</span>
                <span className="text-status-safe">+{live.additions}</span>
                <span className="text-status-blocked">−{live.deletions}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const Icon = statusMeta[live.status].icon;
                  return (
                    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", statusMeta[live.status].chip)}>
                      <Icon className="size-3" aria-hidden />
                      {statusMeta[live.status].label}
                    </span>
                  );
                })()}
                <ReadinessChips readiness={live.readiness} />
                {live.planStep ? (
                  <span className="rounded-full border px-2 py-0.5 text-xs">Merge plan step {live.planStep}</span>
                ) : null}
              </div>

              {live.readiness && live.readiness.reasons.length > 0 && (
                <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
                  {live.readiness.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {parked && !live.readiness?.reasons.length && (
                <p className="text-muted-foreground text-xs">Parked: {parked.reasons.join("; ")}</p>
              )}

              <Separator />

              <EdgeSection
                title="Blocked by"
                empty="Nothing blocks this PR."
                edges={incoming.filter((e) => e.blocking)}
                otherOf={(e) => e.source}
                graph={graph}
                selfLabel={`#${id}`}
                selfIsTarget
              />
              <EdgeSection
                title="Blocking"
                empty="Not blocking any PR."
                edges={outgoing.filter((e) => e.blocking)}
                otherOf={(e) => e.target}
                graph={graph}
                selfLabel={`#${id}`}
              />
              {[...incoming, ...outgoing].some((e) => !e.blocking) && (
                <EdgeSection
                  title="Shares code with (non-blocking)"
                  empty=""
                  edges={[...incoming, ...outgoing].filter((e) => !e.blocking)}
                  otherOf={(e) => (e.source === id ? e.target : e.source)}
                  graph={graph}
                  selfLabel={`#${id}`}
                  selfIsTarget
                />
              )}
              {(live.transitivelyBlockedBy?.length ?? 0) > 0 && (
                <p className="text-muted-foreground text-xs">
                  Indirectly waits on {live.transitivelyBlockedBy!.map((x) => `#${x}`).join(", ")}.
                </p>
              )}

              <div className="flex flex-col gap-2 pt-2">
                {onSimulate && (
                  <Button variant="outline" onClick={() => onSimulate(id)} aria-pressed={simulated}>
                    <FlaskConical className="size-4" />
                    {simulated ? "Undo simulated merge" : "Simulate merging this PR"}
                  </Button>
                )}
                {live.htmlUrl && (
                  <Button render={<a href={live.htmlUrl} target="_blank" rel="noopener noreferrer" />}>
                    Open on GitHub <ExternalLink className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function EdgeSection({
  title,
  empty,
  edges,
  otherOf,
  graph,
  selfLabel,
  selfIsTarget = false,
}: {
  title: string;
  empty: string;
  edges: GraphEdge[];
  otherOf: (e: GraphEdge) => string;
  graph: DependencyGraph;
  selfLabel: string;
  selfIsTarget?: boolean;
}) {
  return (
    <section>
      <p className="mb-1.5 font-medium">
        {title} <span className="text-muted-foreground">({edges.length})</span>
      </p>
      {edges.length === 0 ? (
        empty && <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {edges.map((e) => {
            const other = otherOf(e);
            const sourceLabel = e.source === other ? `#${other}` : selfLabel;
            const targetLabel = e.target === other ? `#${other}` : selfLabel;
            return (
              <li key={e.id} className="space-y-1.5">
                <p className="text-xs">
                  <span className="font-medium">#{other}</span>{" "}
                  <span className="text-muted-foreground">{titleOf(graph, other)}</span>
                </p>
                <p className="text-muted-foreground text-[11px]">
                  {edgeMeta[e.type].description}
                  {e.certainty === "approx" ? " (approximate)" : ""} · {e.severity}
                </p>
                <ConflictRegions edge={e} sourceLabel={sourceLabel} targetLabel={targetLabel} />
                {e.semanticVerdict && (
                  <div className="bg-muted/50 rounded-md border p-2 text-xs">
                    <p className="flex items-center gap-1 font-medium">
                      {e.verdictOrigin !== "heuristic" && <Sparkles className="size-3.5" aria-hidden />}
                      {e.verdictOrigin ? ORIGIN[e.verdictOrigin] : "Analysis"}:{" "}
                      {e.semanticVerdict === "CO_LOCATED"
                        ? "safe to merge in parallel"
                        : e.semanticVerdict === "TRUE_CONFLICT"
                          ? "real conflict"
                          : "uncertain"}
                      {typeof e.confidence === "number" && (
                        <span className="text-muted-foreground font-normal">({Math.round(e.confidence * 100)}%)</span>
                      )}
                    </p>
                    {e.explanation && <p className="mt-0.5">{e.explanation}</p>}
                    {e.resolution && <p className="text-muted-foreground mt-0.5">Suggested: {e.resolution}</p>}
                  </div>
                )}
                {!e.semanticVerdict && selfIsTarget && e.blocking && e.type === "BLOCKS" && (
                  <p className="text-muted-foreground text-[11px]">Merge #{other} first, then rebase {selfLabel}.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
