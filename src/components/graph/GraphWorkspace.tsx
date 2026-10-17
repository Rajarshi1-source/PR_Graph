"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { Network, CircleCheck, FlaskConical, X } from "lucide-react";
import type { DependencyGraph, PRNodeData } from "@/lib/graph/types";
import { whatIfMerge } from "@/lib/graph/whatIf";
import { PRNode, type FlowNodeData } from "./PRNode";
import { DependencyEdge, type DependencyEdgeData } from "./DependencyEdge";
import { GraphLegend } from "./GraphLegend";
import { GraphStats } from "./GraphStats";
import { MergePlanPanel } from "./MergePlanPanel";
import { PRDetailPanel } from "./PRDetailPanel";
import { ExportMenu } from "./ExportMenu";
import { RelativeTime } from "./RelativeTime";
import { edgeStroke } from "./statusMeta";
import { layoutGraph, type LayoutDirection } from "./layout";
import { NodeActivateContext } from "./activate";
import { Button } from "@/components/ui/button";

const nodeTypes = { prNode: PRNode };
const edgeTypes = { dependency: DependencyEdge };

type PRFlowNode = Node<FlowNodeData, "prNode">;

const noopSubscribe = () => () => {};

export interface GraphWorkspaceProps {
  graph: DependencyGraph | null;
  repoName: string;
  /** Live connection indicator (omit in demo mode). */
  connected?: boolean;
  /** Node ids to flash after a live update. */
  flashIds?: Set<string>;
  syncedAt?: string | null;
  syncing?: boolean;
  /** Extra toolbar actions (re-sync, settings, history…). */
  toolbarExtra?: ReactNode;
  /** Strip under the toolbar (offline / demo notice). */
  banner?: ReactNode;
  emptyHint?: string;
}

/**
 * The interactive graph surface shared by the live repo page and the public demo: dagre layout,
 * merge-plan panel, PR detail sheet, what-if merge simulation, workspace lens, critical path,
 * INDIRECT toggle and export. All graph logic comes from the pure `lib/graph` functions.
 */
export function GraphWorkspace({
  graph,
  repoName,
  connected,
  flashIds,
  syncedAt,
  syncing,
  toolbarExtra,
  banner,
  emptyHint = "No open PRs to graph yet.",
}: GraphWorkspaceProps) {
  const [selected, setSelected] = useState<PRNodeData | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [showPlan, setShowPlan] = useState(true);
  const [showIndirect, setShowIndirect] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [simulated, setSimulated] = useState<string[]>([]);
  const [highlightCritical, setHighlightCritical] = useState(false);
  const { resolvedTheme } = useTheme();
  // The theme is only known after hydration; render React Flow as "light" until then so the server
  // and first client render agree, then follow the app theme.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const colorMode = hydrated && resolvedTheme === "dark" ? "dark" : "light";

  const [nodes, setNodes, onNodesChange] = useNodesState<PRFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<DependencyEdgeData>>([]);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const layoutKeyRef = useRef("");

  // Drop simulated ids that no longer exist (a live update may have merged them for real).
  const liveSimulated = useMemo(
    () => simulated.filter((id) => graph?.nodes.some((n) => n.id === id)),
    [simulated, graph],
  );
  const sim = useMemo(
    () => (graph && liveSimulated.length ? whatIfMerge(graph, liveSimulated) : null),
    [graph, liveSimulated],
  );
  const view = sim?.graph ?? graph;

  const workspaces = useMemo(
    () => [...new Set((graph?.nodes ?? []).flatMap((n) => n.data.workspaces ?? []))].sort(),
    [graph],
  );
  const critical = useMemo(
    () => new Set(highlightCritical ? (graph?.mergePlan?.criticalPath ?? []) : []),
    [graph, highlightCritical],
  );

  useEffect(() => {
    if (!graph || !view) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const viewData = new Map(view.nodes.map((n) => [n.id, n.data]));
    const inWorkspace = (data: PRNodeData) => !workspace || (data.workspaces ?? []).includes(workspace);

    const flowNodes: PRFlowNode[] = graph.nodes.map((n) => {
      const data = viewData.get(n.id);
      const shown: FlowNodeData = data
        ? { ...data, dimmed: !inWorkspace(data), critical: critical.has(n.id) }
        : { ...n.data, ghost: true };
      return { id: n.id, type: "prNode", position: { x: 0, y: 0 }, data: shown };
    });
    const dimmed = new Set(flowNodes.filter((n) => n.data.dimmed || n.data.ghost).map((n) => n.id));

    const flowEdges: Edge<DependencyEdgeData>[] = view.edges
      .filter((e) => showIndirect || e.type !== "INDIRECT")
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "dependency",
        data: { edge: e, dimmed: dimmed.has(e.source) || dimmed.has(e.target) },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeStroke(e).color },
      }));

    // Layout on the FULL graph (stable positions across what-if / filters / status-only updates).
    const key = `${direction}:${graph.nodes.map((n) => n.id).sort().join(",")}`;
    let positioned: PRFlowNode[];
    if (key === layoutKeyRef.current && positionsRef.current.size) {
      positioned = flowNodes.map((n) => ({
        ...n,
        position: positionsRef.current.get(n.id) ?? n.position,
        sourcePosition: direction === "LR" ? "right" : "bottom",
        targetPosition: direction === "LR" ? "left" : "top",
      })) as PRFlowNode[];
    } else {
      const layoutEdges = graph.edges
        .filter((e) => e.type !== "INDIRECT")
        .map((e) => ({ id: e.id, source: e.source, target: e.target }));
      positioned = layoutGraph(flowNodes, layoutEdges, direction) as PRFlowNode[];
      positionsRef.current = new Map(positioned.map((n) => [n.id, n.position]));
      layoutKeyRef.current = key;
    }

    setNodes(positioned.map((n) => ({ ...n, className: flashIds?.has(n.id) ? "pr-node-flash" : undefined })));
    setEdges(flowEdges);
  }, [graph, view, direction, flashIds, workspace, showIndirect, critical, setNodes, setEdges]);

  const openNode = useCallback((data: PRNodeData) => {
    setSelected(data);
    setPanelOpen(true);
  }, []);
  const openById = useCallback(
    (id: string) => {
      const n = graph?.nodes.find((x) => x.id === id);
      if (n) openNode(n.data);
    },
    [graph, openNode],
  );
  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => openNode(node.data as PRNodeData), [openNode]);
  const toggleSimulated = useCallback(
    (id: string) => setSimulated((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    [],
  );

  const allSafe = view && view.stats.totalPRs > 0 && view.stats.safePRs === view.stats.totalPRs;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-sm font-semibold">{repoName}</h1>
          {connected !== undefined && (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs" aria-live="polite">
              <span className={`size-2 rounded-full ${connected ? "bg-status-safe" : "bg-muted-foreground"}`} />
              {connected ? "Live" : "Offline"}
            </span>
          )}
          {syncedAt && (
            <span className="text-muted-foreground hidden text-xs sm:inline">
              Synced <RelativeTime iso={syncedAt} />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {view && <GraphStats stats={view.stats} />}
          {workspaces.length > 1 && (
            <label className="text-muted-foreground flex items-center gap-1 text-xs">
              <span className="sr-only sm:not-sr-only">Workspace</span>
              <select
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                className="bg-background text-foreground h-7 rounded-md border px-1.5 text-xs"
                aria-label="Filter by workspace"
              >
                <option value="">All</option>
                {workspaces.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={showIndirect}
            onClick={() => setShowIndirect((v) => !v)}
            title="Show transitive (indirect) dependencies"
          >
            Indirect
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDirection((d) => (d === "TB" ? "LR" : "TB"))} title="Toggle layout direction">
            {direction === "TB" ? "Vertical" : "Horizontal"}
          </Button>
          {toolbarExtra}
        </div>
      </div>

      {banner}

      {sim && (
        <div
          role="status"
          className="bg-muted flex flex-wrap items-center justify-center gap-2 border-b px-4 py-1.5 text-xs"
        >
          <FlaskConical className="size-3.5" aria-hidden />
          <span>
            Simulating merge of {liveSimulated.map((id) => `#${id}`).join(", ")} —{" "}
            {sim.unblocked.length
              ? `${sim.unblocked.length} PR${sim.unblocked.length === 1 ? "" : "s"} would unblock (${sim.unblocked.map((c) => `#${c.prNumber}`).join(", ")})`
              : "no PR would unblock"}
          </span>
          <Button size="xs" variant="outline" onClick={() => setSimulated([])}>
            <X className="size-3" /> Reset
          </Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {syncing && (
          <div className="bg-card/90 absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full border px-3 py-1 text-xs shadow-sm backdrop-blur">
            Updating…
          </div>
        )}

        {!graph || graph.nodes.length === 0 ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
            <Network className="size-8" aria-hidden />
            {emptyHint}
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
              // Keep nodes clear of the overlays: merge plan (right, ≥sm) and legend (bottom-left).
              fitViewOptions={{ padding: { top: "56px", left: "24px", bottom: "48px", right: showPlan ? "320px" : "24px" } }}
              colorMode={colorMode}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable className="!bg-card hidden md:block" />
              <Panel position="top-left">
                <div className="flex items-center gap-2">
                  <ExportMenu graph={view ?? graph} repoName={repoName} />
                  {allSafe && (
                    <span className="bg-status-safe/10 text-status-safe border-status-safe/40 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
                      <CircleCheck className="size-3.5" aria-hidden /> All PRs are safe to merge
                    </span>
                  )}
                </div>
              </Panel>
            </ReactFlow>
          </NodeActivateContext.Provider>
        )}

        {view && showPlan && view.nodes.length > 0 && (
          <div className="absolute top-3 right-3 z-10 hidden sm:block">
            <MergePlanPanel
              graph={view}
              repoName={repoName}
              onSelect={openById}
              highlightCritical={highlightCritical}
              onToggleCritical={() => setHighlightCritical((v) => !v)}
            />
          </div>
        )}

        <div className="absolute bottom-4 left-4 z-10 flex items-end gap-2">
          <div className="hidden sm:block">
            <GraphLegend />
          </div>
          <Button size="sm" variant="outline" className="bg-card/90 hidden backdrop-blur sm:inline-flex" onClick={() => setShowPlan((v) => !v)}>
            {showPlan ? "Hide" : "Show"} merge plan
          </Button>
        </div>
      </div>

      {view && (
        <PRDetailPanel
          node={selected}
          graph={view.nodes.some((n) => n.id === String(selected?.prNumber)) ? view : graph!}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          onSimulate={toggleSimulated}
          simulated={selected ? liveSimulated.includes(String(selected.prNumber)) : false}
        />
      )}
    </div>
  );
}
