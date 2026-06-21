import { statusMeta, edgeLabel, edgeColor } from "./statusMeta";
import type { NodeStatus, EdgeType } from "@/lib/graph/types";
import { cn } from "@/lib/utils";

const statuses: NodeStatus[] = ["SAFE", "BLOCKED", "DEADLOCKED"];
const edges: EdgeType[] = ["TOUCHES", "CO_LOCATED", "BLOCKS", "CRITICAL_BLOCK"];
const dashed = new Set<EdgeType>(["TOUCHES", "CO_LOCATED"]);

/** Floating legend explaining node statuses and edge severities. */
export function GraphLegend() {
  return (
    <div className="bg-card/90 text-card-foreground rounded-lg border p-3 text-xs shadow-sm backdrop-blur">
      <p className="text-muted-foreground mb-1.5 font-medium">Status</p>
      <ul className="mb-2 space-y-1">
        {statuses.map((s) => {
          const Icon = statusMeta[s].icon;
          return (
            <li key={s} className="flex items-center gap-2">
              <Icon className={cn("size-3.5", statusMeta[s].text)} aria-hidden />
              <span>{statusMeta[s].label}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground mb-1.5 font-medium">Dependency</p>
      <ul className="space-y-1">
        {edges.map((e) => (
          <li key={e} className="flex items-center gap-2">
            <span
              className="inline-block w-5"
              style={{
                borderTopWidth: e === "CRITICAL_BLOCK" ? 3 : 2,
                borderTopColor: edgeColor[e],
                borderTopStyle: dashed.has(e) ? "dashed" : "solid",
              }}
              aria-hidden
            />
            <span className="capitalize">{edgeLabel[e]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
