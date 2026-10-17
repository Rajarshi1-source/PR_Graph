"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Settings, History } from "lucide-react";
import { toast } from "sonner";
import type { DependencyGraph } from "@/lib/graph/types";
import { GraphWorkspace } from "./GraphWorkspace";
import { useGraphSocket } from "@/hooks/useGraphSocket";
import { useResync } from "@/hooks/useResync";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

/**
 * Live repo graph: socket-driven updates, re-sync, flash + toast on status changes. The
 * interactive surface itself is the shared `GraphWorkspace` (also used by the public demo).
 */
export function GraphCanvas({
  repoId,
  fullName,
  initialGraph,
  lastSyncAt,
}: {
  repoId: number;
  fullName: string;
  initialGraph: DependencyGraph | null;
  lastSyncAt?: string | null;
}) {
  const { graph, connected, lastUpdate } = useGraphSocket(repoId, initialGraph);
  const resync = useResync(repoId);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [seenUpdate, setSeenUpdate] = useState<typeof lastUpdate>(null);

  // Render-phase reaction to a new socket update (derive-state-during-render pattern).
  if (lastUpdate && lastUpdate !== seenUpdate) {
    setSeenUpdate(lastUpdate);
    setFlashIds(lastUpdate.diff.statusChanges.length ? new Set(lastUpdate.diff.statusChanges.map((c) => c.id)) : new Set());
  }

  useEffect(() => {
    if (!seenUpdate) return;
    if (seenUpdate.diff.newlyUnblocked.length) {
      toast.success(`${seenUpdate.diff.newlyUnblocked.length} PR(s) unblocked`, {
        description: seenUpdate.diff.newlyUnblocked.map((c) => `#${c.prNumber}`).join(", "),
      });
    }
    if (!seenUpdate.diff.statusChanges.length) return;
    const t = setTimeout(() => setFlashIds(new Set()), 2200);
    return () => clearTimeout(t);
  }, [seenUpdate]);

  const onSync = useCallback(() => {
    resync.mutate(undefined, {
      onSuccess: () => toast.success("Re-sync complete"),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Sync failed"),
    });
  }, [resync]);

  const syncing = resync.isPending;

  return (
    <GraphWorkspace
      graph={graph}
      repoName={fullName}
      connected={connected}
      flashIds={flashIds}
      syncedAt={lastUpdate?.syncedAt ?? lastSyncAt ?? null}
      syncing={syncing}
      emptyHint="No open PRs to graph yet. Try a re-sync."
      banner={
        !connected && graph ? (
          <div className="bg-status-at-risk-bg text-foreground border-b px-4 py-1.5 text-center text-xs">
            Reconnecting to live updates — showing the last known graph.
          </div>
        ) : null
      }
      toolbarExtra={
        <>
          <Button size="sm" variant="outline" onClick={onSync} disabled={syncing}>
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Re-sync</span>
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Graph history" render={<Link href={`/repo/${fullName}/history`} />}>
            <History className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Repo settings" render={<Link href={`/repo/${fullName}/settings`} />}>
            <Settings className="size-4" />
          </Button>
        </>
      }
    />
  );
}
