import { FileWarning } from "lucide-react";
import type { DependencyGraph, PRNodeData } from "@/lib/graph/types";

/** Lists the files this PR shares with the PRs it conflicts with (the source of every edge). */
export function ConflictFileList({ node, graph }: { node: PRNodeData; graph: DependencyGraph }) {
  const id = String(node.prNumber);
  const files = new Map<string, Set<string>>(); // filename -> set of other PR ids
  for (const e of graph.edges) {
    if (e.source !== id && e.target !== id) continue;
    const other = e.source === id ? e.target : e.source;
    for (const f of e.sharedFiles) {
      const set = files.get(f) ?? new Set<string>();
      set.add(other);
      files.set(f, set);
    }
  }

  if (files.size === 0) {
    return <p className="text-muted-foreground text-xs">No overlapping files.</p>;
  }

  return (
    <ul className="space-y-1">
      {[...files.entries()].map(([filename, others]) => (
        <li key={filename} className="flex items-start gap-1.5 text-xs">
          <FileWarning className="text-status-blocked mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="break-all font-mono">{filename}</span>{" "}
            <span className="text-muted-foreground">
              · shared with {[...others].map((o) => `#${o}`).join(", ")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
