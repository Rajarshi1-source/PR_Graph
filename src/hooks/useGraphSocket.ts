"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket/client";
import type { DependencyGraph } from "@/lib/graph/types";
import type { GraphDiff } from "@/lib/graph/diffGraphs";

export interface GraphUpdate {
  graph: DependencyGraph;
  diff: GraphDiff;
  syncedAt: string;
}

/**
 * Subscribe to a repo's live graph updates (§B.4 WebSocket contract). Returns the latest
 * graph snapshot pushed by the server plus connection status. Seeds with `initial`.
 */
export function useGraphSocket(
  repoId: number,
  initial: DependencyGraph | null,
): { graph: DependencyGraph | null; connected: boolean; lastUpdate: GraphUpdate | null } {
  const [graph, setGraph] = useState<DependencyGraph | null>(initial);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<GraphUpdate | null>(null);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      socket.emit("graph:subscribe", String(repoId));
    };
    const onDisconnect = () => setConnected(false);
    const onCurrent = (g: DependencyGraph) => setGraph(g);
    const onUpdated = (update: GraphUpdate) => {
      setGraph(update.graph);
      setLastUpdate(update);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("graph:current", onCurrent);
    socket.on("graph:updated", onUpdated);
    if (socket.connected) onConnect();

    return () => {
      socket.emit("graph:unsubscribe", String(repoId));
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("graph:current", onCurrent);
      socket.off("graph:updated", onUpdated);
    };
  }, [repoId]);

  return { graph, connected, lastUpdate };
}
