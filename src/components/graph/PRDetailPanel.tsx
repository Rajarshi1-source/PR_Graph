"use client";

import { ExternalLink } from "lucide-react";
import type { DependencyGraph, PRNodeData } from "@/lib/graph/types";
import { statusMeta } from "./statusMeta";
import { ConflictFileList } from "./ConflictFileList";
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

function prTitle(graph: DependencyGraph, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.data.title ?? `#${id}`;
}

export function PRDetailPanel({
  node,
  graph,
  open,
  onOpenChange,
}: {
  node: PRNodeData | null;
  graph: DependencyGraph;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {node && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", statusMeta[node.status].dot)} />
                PR #{node.prNumber}
              </SheetTitle>
              <SheetDescription className="text-foreground text-base font-medium">
                {node.title}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 text-sm">
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>by {node.author}</span>
                <span>{node.filesChanged} files</span>
                <span className="text-status-safe">+{node.additions}</span>
                <span className="text-status-deadlocked">−{node.deletions}</span>
              </div>

              {(() => {
                const Icon = statusMeta[node.status].icon;
                return (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                      statusMeta[node.status].chip,
                    )}
                  >
                    <Icon className="size-3" aria-hidden />
                    {statusMeta[node.status].label}
                  </span>
                );
              })()}

              <Separator />

              <DependencyList
                title="Blocked by"
                ids={node.blockedBy}
                empty="Nothing — ready to merge."
                graph={graph}
              />
              <DependencyList
                title="Blocking"
                ids={node.blocking}
                empty="Not blocking any PRs."
                graph={graph}
              />

              <div>
                <p className="mb-1 font-medium">Conflicting files</p>
                <ConflictFileList node={node} graph={graph} />
              </div>

              <Button
                className="w-full"
                render={<a href={node.htmlUrl} target="_blank" rel="noopener noreferrer" />}
              >
                Open on GitHub <ExternalLink className="size-4" />
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DependencyList({
  title,
  ids,
  empty,
  graph,
}: {
  title: string;
  ids: string[];
  empty: string;
  graph: DependencyGraph;
}) {
  return (
    <div>
      <p className="mb-1 font-medium">
        {title} <span className="text-muted-foreground">({ids.length})</span>
      </p>
      {ids.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {ids.map((id) => (
            <li key={id} className="text-muted-foreground truncate text-xs">
              #{id} · {prTitle(graph, id)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
