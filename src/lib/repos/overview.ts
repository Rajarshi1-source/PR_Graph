import { prisma } from "@/lib/db/prisma";
import { getCachedGraph } from "@/lib/cache/graphCache";
import { normalizeGraph } from "@/lib/graph/normalize";
import type { DependencyGraph, NodeStatus } from "@/lib/graph/types";

const SPARK_POINTS = 20;

export interface RepoHealth {
  id: number;
  fullName: string;
  prCount: number;
  lastSyncAt: string | null;
  counts: Record<NodeStatus, number>;
  /** Blocked + deadlocked PR count over the last snapshots, oldest → newest. */
  blockedTrend: number[];
  /** The open PR that holds back the most others (transitively), if any. */
  topBlocker: { number: number; title: string; holds: number } | null;
}

export interface BlockedItem {
  repo: string;
  number: number;
  title: string;
  status: NodeStatus;
  waitsOn: number[];
  url: string;
}

export interface Overview {
  repos: RepoHealth[];
  blocked: BlockedItem[];
}

function transitiveDependents(graph: DependencyGraph, id: string): number {
  const out = new Map<string, string[]>();
  for (const e of graph.edges) if (e.blocking && e.type !== "INDIRECT") out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const seen = new Set<string>();
  const stack = [...(out.get(id) ?? [])];
  while (stack.length) {
    const v = stack.pop()!;
    if (seen.has(v) || v === id) continue;
    seen.add(v);
    stack.push(...(out.get(v) ?? []));
  }
  return seen.size;
}

/**
 * Cross-repo health for one user (org overview / multi-repo view): status counts from the current
 * graph, a blocked-count trend from recent snapshots, the biggest blocker, and every blocked PR
 * across all their repos.
 */
export async function getOverview(userId: number): Promise<Overview> {
  const repos = await prisma.repository.findMany({
    where: { installation: { userId } },
    include: { _count: { select: { pullRequests: true } } },
    orderBy: { createdAt: "desc" },
  });

  const result = await Promise.all(
    repos.map(async (repo) => {
      const [snaps, cached] = await Promise.all([
        prisma.graphSnapshot.findMany({
          where: { repoId: repo.id },
          orderBy: { createdAt: "desc" },
          take: SPARK_POINTS,
          select: { blockedPRs: true, deadlockedPRs: true, graphJson: true },
        }),
        getCachedGraph(repo.id).catch(() => null),
      ]);
      const graph = cached ?? (snaps[0] ? normalizeGraph(snaps[0].graphJson) : null);
      const counts: Record<NodeStatus, number> = { SAFE: 0, AT_RISK: 0, BLOCKED: 0, DEADLOCKED: 0 };
      for (const n of graph?.nodes ?? []) counts[n.data.status]++;

      let topBlocker: RepoHealth["topBlocker"] = null;
      for (const n of graph?.nodes ?? []) {
        const holds = transitiveDependents(graph!, n.id);
        if (holds > 0 && (!topBlocker || holds > topBlocker.holds)) {
          topBlocker = { number: n.data.prNumber, title: n.data.title, holds };
        }
      }

      const blocked: BlockedItem[] = (graph?.nodes ?? [])
        .filter((n) => n.data.status === "BLOCKED" || n.data.status === "DEADLOCKED")
        .map((n) => ({
          repo: repo.fullName,
          number: n.data.prNumber,
          title: n.data.title,
          status: n.data.status,
          waitsOn: n.data.blockedBy.map(Number),
          url: n.data.htmlUrl,
        }));

      const health: RepoHealth = {
        id: repo.id,
        fullName: repo.fullName,
        prCount: repo._count.pullRequests,
        lastSyncAt: repo.lastSyncAt?.toISOString() ?? null,
        counts,
        blockedTrend: snaps.map((s) => s.blockedPRs + s.deadlockedPRs).reverse(),
        topBlocker,
      };
      return { health, blocked };
    }),
  );

  return {
    repos: result.map((r) => r.health),
    blocked: result
      .flatMap((r) => r.blocked)
      .sort((a, b) => (a.status === b.status ? a.repo.localeCompare(b.repo) || a.number - b.number : a.status === "DEADLOCKED" ? -1 : 1)),
  };
}
