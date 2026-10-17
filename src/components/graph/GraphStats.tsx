import type { GraphStats as Stats } from "@/lib/graph/types";
import { statusMeta } from "./statusMeta";
import { cn } from "@/lib/utils";

/** Compact at-a-glance counts for the toolbar. */
export function GraphStats({ stats }: { stats: Stats }) {
  const items = [
    { key: "SAFE" as const, value: stats.safePRs },
    { key: "AT_RISK" as const, value: stats.atRiskPRs ?? 0 },
    { key: "BLOCKED" as const, value: stats.blockedPRs },
    { key: "DEADLOCKED" as const, value: stats.deadlockedPRs },
  ];
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground hidden md:inline">
        {stats.totalPRs} PRs · {stats.blockingDependencies ?? stats.totalDependencies} blocking
      </span>
      {items.map(({ key, value }) => (
        <span key={key} className="inline-flex items-center gap-1.5" title={statusMeta[key].label}>
          <span className={cn("size-2.5 rounded-full", statusMeta[key].dot)} aria-hidden />
          <span className="tabular-nums">{value}</span>
          <span className="text-muted-foreground sr-only lg:not-sr-only">{statusMeta[key].short}</span>
        </span>
      ))}
    </div>
  );
}
