import { prisma } from "@/lib/db/prisma";
import { buildDependencyGraph } from "./buildDependencyGraph";
import { diffGraphs } from "./diffGraphs";
import type { DependencyGraph, PRWithFiles } from "./types";
import { fetchOpenPRs } from "@/lib/github/fetchPRs";
import { fetchPRFiles } from "@/lib/github/fetchPRFiles";
import { toPRWithFiles } from "@/lib/github/mapToPR";
import type { RepoRef, RawPR, RawPRFile } from "@/lib/github/types";
import { getCachedGraph, setCachedGraph } from "@/lib/cache/graphCache";
import { pushGraphUpdate } from "@/lib/websocket/server";
import { notifyUnblocked } from "@/lib/slack/notifyUnblocked";
import { graphRecomputes, recomputeDuration } from "@/lib/metrics";

/** Build a RepoRef from a DB Repository row (+ installation). */
function toRepoRef(repo: {
  id: number;
  fullName: string;
  installation: { githubInstallId: number };
}): RepoRef {
  const [owner, name] = repo.fullName.split("/");
  return { id: repo.id, owner, name, installationId: repo.installation.githubInstallId };
}

export interface RecomputeResult {
  graph: DependencyGraph;
  computeTimeMs: number;
}

/**
 * Recompute the whole dependency graph for a repo from current GitHub state. Idempotent
 * w.r.t. webhook ordering (full recompute, not deltas). Persists PRs/files/deps + a snapshot,
 * caches the graph, pushes the diff over Socket.IO, and fires the Slack notification.
 */
export async function recomputeGraph(input: {
  repoId: number;
  triggeredBy: string;
}): Promise<RecomputeResult | null> {
  const repo = await prisma.repository.findUnique({
    where: { id: input.repoId },
    include: { installation: true },
  });
  if (!repo) return null;

  const ref = toRepoRef(repo);
  const t0 = Date.now();

  // 1. Fetch current open PRs + their files (cached).
  const rawPRs = await fetchOpenPRs(ref);
  const enriched = await Promise.all(
    rawPRs.map(async (raw) => {
      const files = await fetchPRFiles(ref, raw.number);
      return { raw, files, pr: toPRWithFiles(raw, files) };
    }),
  );

  // 2. Build the graph (pure engine).
  const graph = buildDependencyGraph(enriched.map((e) => e.pr));
  const computeTimeMs = Date.now() - t0;
  recomputeDuration.observe(computeTimeMs);
  graphRecomputes.inc({ trigger: input.triggeredBy.split(":")[0] });

  // 3. Diff against the previous snapshot.
  const prev = (await getCachedGraph(input.repoId)) ?? (await loadLatestSnapshotGraph(input.repoId));
  const diff = diffGraphs(prev, graph);

  // 4. Persist (PRs, files, dependency edges, snapshot).
  await persistGraph(input.repoId, enriched, graph, input.triggeredBy, computeTimeMs);

  // 5. Cache + push + notify.
  await setCachedGraph(input.repoId, graph);
  pushGraphUpdate(input.repoId, { graph, diff, syncedAt: new Date().toISOString() });
  await notifyUnblocked(input.repoId, repo.fullName, diff);

  return { graph, computeTimeMs };
}

async function loadLatestSnapshotGraph(repoId: number): Promise<DependencyGraph | null> {
  const snap = await prisma.graphSnapshot.findFirst({
    where: { repoId },
    orderBy: { createdAt: "desc" },
  });
  return snap ? (snap.graphJson as unknown as DependencyGraph) : null;
}

type Enriched = { raw: RawPR; files: RawPRFile[]; pr: PRWithFiles };

async function persistGraph(
  repoId: number,
  enriched: Enriched[],
  graph: DependencyGraph,
  triggeredBy: string,
  computeTimeMs: number,
): Promise<void> {
  const currentNumbers = enriched.map((e) => e.raw.number);

  await prisma.$transaction(async (tx) => {
    // Drop PRs that are no longer open (cascade removes their files + edges).
    await tx.pullRequest.deleteMany({
      where: { repoId, number: { notIn: currentNumbers.length ? currentNumbers : [-1] } },
    });

    // Upsert PRs + replace their files. Map PR number → DB id for the edges.
    const numberToId = new Map<number, number>();
    for (const e of enriched) {
      const additions = e.files.reduce((s, f) => s + f.additions, 0);
      const deletions = e.files.reduce((s, f) => s + f.deletions, 0);
      const pr = await tx.pullRequest.upsert({
        where: { repoId_number: { repoId, number: e.raw.number } },
        create: {
          repoId,
          githubPrId: e.raw.id,
          number: e.raw.number,
          title: e.raw.title,
          authorLogin: e.raw.user?.login ?? "unknown",
          authorAvatar: e.raw.user?.avatar_url,
          state: "open",
          htmlUrl: e.raw.html_url,
          additions,
          deletions,
          prCreatedAt: new Date(e.raw.created_at),
          prUpdatedAt: new Date(e.raw.updated_at),
        },
        update: {
          title: e.raw.title,
          authorLogin: e.raw.user?.login ?? "unknown",
          authorAvatar: e.raw.user?.avatar_url,
          additions,
          deletions,
          prUpdatedAt: new Date(e.raw.updated_at),
        },
      });
      numberToId.set(e.raw.number, pr.id);

      await tx.pRFile.deleteMany({ where: { prId: pr.id } });
      if (e.files.length) {
        await tx.pRFile.createMany({
          data: e.files.map((f) => ({
            prId: pr.id,
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
          })),
        });
      }
    }

    // Rebuild dependency edges from the computed graph.
    await tx.dependency.deleteMany({ where: { repoId } });
    const edges = graph.edges
      .map((edge) => {
        const blockerPrId = numberToId.get(Number(edge.source));
        const blockedPrId = numberToId.get(Number(edge.target));
        if (!blockerPrId || !blockedPrId) return null;
        return {
          repoId,
          blockerPrId,
          blockedPrId,
          edgeType: edge.type,
          sharedFiles: edge.sharedFiles,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (edges.length) await tx.dependency.createMany({ data: edges, skipDuplicates: true });

    // History snapshot.
    await tx.graphSnapshot.create({
      data: {
        repoId,
        totalPRs: graph.stats.totalPRs,
        safePRs: graph.stats.safePRs,
        blockedPRs: graph.stats.blockedPRs,
        deadlockedPRs: graph.stats.deadlockedPRs,
        totalEdges: graph.stats.totalDependencies,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mergeOrder: graph.mergeOrder as any,
        triggeredBy,
        computeTimeMs,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graphJson: graph as any,
      },
    });

    await tx.repository.update({ where: { id: repoId }, data: { lastSyncAt: new Date() } });
  });
}

/** Read the current graph for a repo (cache → latest snapshot), authorized to the user. */
export async function getGraphForRepo(
  repoId: number,
  userId: number,
): Promise<DependencyGraph | null> {
  const repo = await prisma.repository.findFirst({
    where: { id: repoId, installation: { userId } },
    select: { id: true },
  });
  if (!repo) return null;
  return (await getCachedGraph(repoId)) ?? (await loadLatestSnapshotGraph(repoId));
}

/** Server-component initial fetch by owner/name. Returns the graph + repoId, or null. */
export async function getInitialGraph(
  owner: string,
  name: string,
): Promise<{ repoId: number; graph: DependencyGraph | null } | null> {
  const repo = await prisma.repository.findFirst({
    where: { fullName: `${owner}/${name}` },
    select: { id: true },
  });
  if (!repo) return null;
  const graph = (await getCachedGraph(repo.id)) ?? (await loadLatestSnapshotGraph(repo.id));
  return { repoId: repo.id, graph };
}
