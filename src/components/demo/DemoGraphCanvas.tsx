"use client";

import type { DependencyGraph } from "@/lib/graph/types";
import { GraphWorkspace } from "@/components/graph/GraphWorkspace";
import { PreflightPlayground } from "./PreflightPlayground";

/**
 * The public demo: the same `GraphWorkspace` as the live page, fed by fixtures that ran through the
 * real engine on the server. No socket, no re-sync, no settings.
 */
export function DemoGraphCanvas({ graph, repoName }: { graph: DependencyGraph; repoName: string }) {
  return (
    <GraphWorkspace
      graph={graph}
      repoName={repoName}
      banner={
        <div className="bg-muted text-muted-foreground border-b px-4 py-1.5 text-center text-xs">
          Demo data — a fictional <span className="text-foreground font-medium">{repoName}</span> repo with 15 open PRs.
          Click a PR, simulate a merge, or try the preflight check.
        </div>
      }
      toolbarExtra={<PreflightPlayground />}
    />
  );
}
