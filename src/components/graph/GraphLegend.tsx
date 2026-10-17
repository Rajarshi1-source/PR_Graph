import { statusMeta, edgeMeta, STATUS_ORDER, EDGE_ORDER } from "./statusMeta";
import { cn } from "@/lib/utils";

/** Floating legend explaining node statuses and edge types (colour + icon/dash + label). */
export function GraphLegend() {
  return (
    <div className="bg-card/90 text-card-foreground rounded-lg border p-3 text-xs shadow-sm backdrop-blur">
      <p className="text-muted-foreground mb-1.5 font-medium">Status</p>
      <ul className="mb-2 space-y-1">
        {STATUS_ORDER.map((s) => {
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
        {EDGE_ORDER.map((e) => (
          <li key={e} className="flex items-center gap-2" title={edgeMeta[e].description}>
            <svg width="20" height="6" aria-hidden className="shrink-0">
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke={edgeMeta[e].color}
                strokeWidth={Math.max(edgeMeta[e].width, 1.5)}
                strokeDasharray={edgeMeta[e].dash}
              />
            </svg>
            <span>{edgeMeta[e].label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
