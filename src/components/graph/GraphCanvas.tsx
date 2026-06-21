"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  MarkerType,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { RefreshCw, Settings } from "lucide-react";
import { toast } from "sonner";
import type { DependencyGraph, PRNodeData } from "@/lib/graph/types";
import { PRNode } from "./PRNode";
import { GraphLegend } from "./GraphLegend";
import { GraphStats } from "./GraphStats";
import { PRDetailPanel } from "./PRDetailPanel";
import { edgeColor, edgeLabel } from "./statusMeta";
import { layoutGraph } from "./layout";
import { useGraphSocket } from "@/hooks/useGraphSocket";
import { Button } from "@/components/ui/button";

const nodeTypes = { prNode: PRNode };

function toFlow(graph: DependencyGraph): { nodes: Node<PRNodeData>[]; edges: Edge[] } {
  const nodes: Node<PRNodeData>[] = graph.nodes.map((n) => ({
    id: n.id,
    type: "prNode",
    position: n.position,
    data: n.data,
  }));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: edgeLabel[e.type],
    animated: e.type !== "TOUCHES",
    style: { stroke: edgeColor[e.type], strokeWidth: e.type === "CRITICAL_BLOCK" ? 2.5 : 1.5 },
    labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
    labelBgStyle: { fill: "var(--background)" },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor[e.type] },
  }));
  return { nodes: layoutGraph(nodes, edges), edges };
}

export function GraphCanvas({
  repoId,
  fullName,
  initialGraph,
}: {
  repoId: number;
  fullName: string;
  initialGraph: DependencyGraph | null;
}) {
  const { graph, connected, lastUpdate } = useGraphSocket(repoId, initialGraph);
  const [selected, setSelected] = useState<PRNodeData | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const flow = useMemo(() => (graph ? toFlow(graph) : { nodes: [], edges: [] }), [graph]);

  useEffect(() => {
    if (lastUpdate?.diff.newlyUnblocked.length) {
      toast.success(
        `${lastUpdate.diff.newlyUnblocked.length} PR(s) now safe to merge`,
        { description: lastUpdate.diff.newlyUnblocked.map((c) => `#${c.prNumber}`).join(", ") },
      );
    }
  }, [lastUpdate]);

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    setSelected(node.data as PRNodeData);
    setPanelOpen(true);
  }, []);

  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/sync`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "Sync failed");
      toast.success("Re-sync complete");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [repoId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">{fullName}</h1>
          <span
            className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
            aria-live="polite"
          >
            <span
              className={`size-2 rounded-full ${connected ? "bg-status-safe" : "bg-muted-foreground"}`}
            />
            {connected ? "Live" : "Offline"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {graph && <GraphStats stats={graph.stats} />}
          <Button size="sm" variant="outline" onClick={onSync} disabled={syncing}>
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
            Re-sync
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Repo settings"
            render={<Link href={`/repo/${fullName}/settings`} />}
          >
            <Settings className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative flex-1">
        {flow.nodes.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No open PRs to graph yet. Try a re-sync.
          </div>
        ) : (
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            fitView
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable className="!bg-card" />
          </ReactFlow>
        )}
        <div className="absolute bottom-4 left-4 z-10">
          <GraphLegend />
        </div>
      </div>

      {graph && (
        <PRDetailPanel
          node={selected}
          graph={graph}
          open={panelOpen}
          onOpenChange={setPanelOpen}
        />
      )}
    </div>
  );
}
