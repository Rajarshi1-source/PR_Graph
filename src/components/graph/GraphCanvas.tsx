"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { RefreshCw, Settings, Network, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import type { DependencyGraph, PRNodeData } from "@/lib/graph/types";
import { PRNode } from "./PRNode";
import { DependencyEdge } from "./DependencyEdge";
import { GraphLegend } from "./GraphLegend";
import { GraphStats } from "./GraphStats";
import { MergeOrderPanel } from "./MergeOrderPanel";
import { PRDetailPanel } from "./PRDetailPanel";
import { edgeColor } from "./statusMeta";
import { layoutGraph, type LayoutDirection } from "./layout";
import { NodeActivateContext } from "./activate";
import { useGraphSocket } from "@/hooks/useGraphSocket";
import { useResync } from "@/hooks/useResync";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

const nodeTypes = { prNode: PRNode };
const edgeTypes = { dependency: DependencyEdge };

type PRFlowNode = Node<PRNodeData, "prNode">;

/** Build React Flow edges from the graph (positions handled separately by dagre). */
function toEdges(graph: DependencyGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "dependency",
    data: { edgeType: e.type, sharedFiles: e.sharedFiles },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor[e.type] },
  }));
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
  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [showMergeOrder, setShowMergeOrder] = useState(true);
  const resync = useResync(repoId);
  const syncing = resync.isPending;

  const [nodes, setNodes, onNodesChange] = useNodesState<PRFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Preserve node positions across status-only updates so the viewport doesn't jump; only re-run
  // dagre when the set of nodes (or layout direction) changes.
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const layoutKeyRef = useRef<string>("");
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [seenUpdate, setSeenUpdate] = useState<typeof lastUpdate>(null);

  // Render-phase reaction to a new socket update: seed the flash set (the documented "derive
  // state during render" pattern, not a setState-in-effect).
  if (lastUpdate && lastUpdate !== seenUpdate) {
    setSeenUpdate(lastUpdate);
    setFlashIds(
      lastUpdate.diff.statusChanges.length
        ? new Set(lastUpdate.diff.statusChanges.map((c) => c.id))
        : new Set(),
    );
  }

  // Side effects for the latest update: toast + auto-clear the status-change highlight.
  useEffect(() => {
    if (!seenUpdate) return;
    if (seenUpdate.diff.newlyUnblocked.length) {
      toast.success(`${seenUpdate.diff.newlyUnblocked.length} PR(s) now safe to merge`, {
        description: seenUpdate.diff.newlyUnblocked.map((c) => `#${c.prNumber}`).join(", "),
      });
    }
    if (!seenUpdate.diff.statusChanges.length) return;
    const t = setTimeout(() => setFlashIds(new Set()), 2200);
    return () => clearTimeout(t);
  }, [seenUpdate]);

  // Rebuild/patch the controlled nodes + edges whenever the graph, direction, or flash set changes.
  useEffect(() => {
    if (!graph) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const flowEdges = toEdges(graph);
    const base: PRFlowNode[] = graph.nodes.map((n) => ({
      id: n.id,
      type: "prNode",
      position: { x: 0, y: 0 },
      data: n.data,
    }));

    const key = `${direction}:${graph.nodes.map((n) => n.id).sort().join(",")}`;
    let positioned: PRFlowNode[];
    if (key === layoutKeyRef.current && positionsRef.current.size) {
      positioned = base.map((n) => ({
        ...n,
        position: positionsRef.current.get(n.id) ?? n.position,
        sourcePosition: direction === "LR" ? "right" : "bottom",
        targetPosition: direction === "LR" ? "left" : "top",
      })) as PRFlowNode[];
    } else {
      positioned = layoutGraph(base, flowEdges, direction) as PRFlowNode[];
      positionsRef.current = new Map(positioned.map((n) => [n.id, n.position]));
      layoutKeyRef.current = key;
    }

    setNodes(positioned.map((n) => ({ ...n, className: flashIds.has(n.id) ? "pr-node-flash" : undefined })));
    setEdges(flowEdges);
  }, [graph, direction, flashIds, setNodes, setEdges]);

  const openNode = useCallback((data: PRNodeData) => {
    setSelected(data);
    setPanelOpen(true);
  }, []);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => openNode(node.data as PRNodeData),
    [openNode],
  );

  const onSync = useCallback(() => {
    resync.mutate(undefined, {
      onSuccess: () => toast.success("Re-sync complete"),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Sync failed"),
    });
  }, [resync]);

  const allSafe =
    graph && graph.stats.totalPRs > 0 && graph.stats.safePRs === graph.stats.totalPRs;

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
        <div className="flex items-center gap-2 sm:gap-3">
          {graph && <GraphStats stats={graph.stats} />}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDirection((d) => (d === "TB" ? "LR" : "TB"))}
            title="Toggle layout direction"
          >
            {direction === "TB" ? "Vertical" : "Horizontal"}
          </Button>
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

      {!connected && graph && (
        <div className="bg-status-blocked-bg text-status-blocked border-status-blocked/30 border-b px-4 py-1.5 text-center text-xs">
          Reconnecting to live updates — showing the last known graph.
        </div>
      )}

      <div className="relative flex-1">
        {syncing && (
          <div className="bg-card/90 absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full border px-3 py-1 text-xs shadow-sm backdrop-blur">
            Updating…
          </div>
        )}

        {!graph || graph.nodes.length === 0 ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
            <Network className="size-8" aria-hidden />
            No open PRs to graph yet. Try a re-sync.
          </div>
        ) : (
          <NodeActivateContext.Provider value={openNode}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              fitView
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable className="!bg-card" />
            </ReactFlow>
          </NodeActivateContext.Provider>
        )}

        {allSafe && (
          <div className="bg-status-safe/10 text-status-safe absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-status-safe/40 px-3 py-1 text-xs font-medium">
            <CircleCheck className="size-3.5" aria-hidden /> All PRs are safe to merge
          </div>
        )}

        {graph && showMergeOrder && graph.nodes.length > 0 && (
          <div className="absolute top-3 right-3 z-10">
            <MergeOrderPanel graph={graph} />
          </div>
        )}

        <div className="absolute bottom-4 left-4 z-10 flex items-end gap-2">
          <GraphLegend />
          <Button
            size="sm"
            variant="outline"
            className="bg-card/90 backdrop-blur"
            onClick={() => setShowMergeOrder((v) => !v)}
          >
            {showMergeOrder ? "Hide" : "Show"} merge order
          </Button>
        </div>
      </div>

      {graph && (
        <PRDetailPanel node={selected} graph={graph} open={panelOpen} onOpenChange={setPanelOpen} />
      )}
    </div>
  );
}
