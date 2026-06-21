import { redis } from "./redis";
import type { DependencyGraph } from "@/lib/graph/types";

const GRAPH_TTL_SECONDS = 300; // 5 min — clients get a stale-but-valid graph during recompute

const graphKey = (repoId: number) => `graph:${repoId}`;
const versionKey = (repoId: number) => `graph:version:${repoId}`;

export async function getCachedGraph(repoId: number): Promise<DependencyGraph | null> {
  const hit = await redis.get(graphKey(repoId));
  return hit ? (JSON.parse(hit) as DependencyGraph) : null;
}

export async function setCachedGraph(repoId: number, graph: DependencyGraph): Promise<number> {
  await redis.set(graphKey(repoId), JSON.stringify(graph), "EX", GRAPH_TTL_SECONDS);
  return redis.incr(versionKey(repoId));
}

export async function invalidateGraph(repoId: number): Promise<void> {
  await redis.del(graphKey(repoId));
}

export async function getGraphVersion(repoId: number): Promise<number> {
  const v = await redis.get(versionKey(repoId));
  return v ? Number(v) : 0;
}
