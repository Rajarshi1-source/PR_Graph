"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { SnapshotDiffSchema } from "@/lib/api/schemas";
import type { NodeStatus } from "@/lib/graph/types";
import { statusMeta } from "@/components/graph/statusMeta";
import { RelativeTime } from "@/components/graph/RelativeTime";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: number;
  totalPRs: number;
  safePRs: number;
  blockedPRs: number;
  deadlockedPRs: number;
  totalEdges: number;
  triggeredBy: string;
  computeTimeMs: number;
  createdAt: string;
}

function triggerLabel(t: string): string {
  if (t === "manual_sync") return "Manual re-sync";
  if (t.startsWith("coalesced")) return "Coalesced webhooks";
  if (t.startsWith("readiness")) return "CI / review update";
  if (t.startsWith("check_run")) return "Re-check button";
  if (t.startsWith("reconcile")) return "Scheduled reconcile";
  const [, action, pr] = t.split(":");
  return action ? `PR ${pr ? `#${pr} ` : ""}${action.replace(/_/g, " ")}` : t;
}

function StatusChip({ status }: { status: string }) {
  const meta = statusMeta[status as NodeStatus];
  if (!meta) return <span>{status}</span>;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]", meta.chip)}>
      <Icon className="size-3" aria-hidden />
      {meta.short}
    </span>
  );
}

/** "What changed since the last computation" — snapshot list + per-snapshot diff. */
export function HistoryTimeline({ repoId, items }: { repoId: number; items: TimelineItem[] }) {
  const [selected, setSelected] = useState<number | null>(items[0]?.id ?? null);
  const { data, isPending, isError } = useQuery({
    queryKey: ["snapshot-diff", repoId, selected],
    queryFn: () => apiFetch(`/api/repos/${repoId}/graph/history/${selected}`, SnapshotDiffSchema),
    enabled: selected !== null,
    staleTime: Infinity, // snapshots never change
  });

  if (!items.length) return <Card className="p-6 text-sm">No graph computations yet — run a sync from the graph page.</Card>;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_1fr]">
      <ol className="space-y-1" aria-label="Graph snapshots">
        {items.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              aria-pressed={selected === s.id}
              onClick={() => setSelected(s.id)}
              className={cn(
                "hover:bg-muted focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none",
                selected === s.id && "bg-muted border-ring",
              )}
            >
              <span className="block font-medium">{triggerLabel(s.triggeredBy)}</span>
              <span className="text-muted-foreground block text-xs">
                <RelativeTime iso={s.createdAt} /> · {s.totalPRs} PRs · {s.blockedPRs} blocked · {s.computeTimeMs} ms
              </span>
            </button>
          </li>
        ))}
      </ol>

      <Card className="gap-3 p-5 text-sm" aria-live="polite">
        {isPending && <p className="text-muted-foreground">Loading…</p>}
        {isError && <p className="text-status-blocked">Could not load this snapshot.</p>}
        {data && (
          <>
            <p className="font-semibold">
              {triggerLabel(data.snapshot.triggeredBy)}{" "}
              <span className="text-muted-foreground font-normal">
                {data.previousId ? "vs the previous computation" : "(first computation)"}
              </span>
            </p>
            <div className="flex flex-wrap gap-3 text-xs">
              <span>{data.snapshot.totalPRs} PRs</span>
              <span>{data.snapshot.safePRs} safe</span>
              <span>{data.snapshot.blockedPRs} blocked</span>
              <span>{data.snapshot.deadlockedPRs} deadlocked</span>
              <span>{data.snapshot.totalEdges} edges</span>
            </div>
            {data.diff.added.length > 0 && <p>Opened: {data.diff.added.map((id) => `#${id}`).join(", ")}</p>}
            {data.diff.removed.length > 0 && <p>Merged or closed: {data.diff.removed.map((id) => `#${id}`).join(", ")}</p>}
            {data.diff.statusChanges.length > 0 ? (
              <ul className="space-y-1.5">
                {data.diff.statusChanges.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">#{c.prNumber}</span>
                    <span className="text-muted-foreground max-w-[16rem] truncate">{c.title}</span>
                    <StatusChip status={c.from} />
                    <ArrowRight className="size-3" aria-hidden />
                    <StatusChip status={c.to} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No status changes.</p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
