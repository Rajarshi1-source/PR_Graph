import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { buildDependencyGraph } from "./buildDependencyGraph";
import { refineGraph, analyzableEdges, type RefineVerdict } from "./refineGraph";
import { normalizeGraph } from "./normalize";
import {
  applyDeepVerdicts,
  deepCandidates,
  simulateSequentialMerge,
  type DeepOutcome,
  type DeepResults,
} from "./mergeSim";
import { getFileAt, getMergeContext, type BlobResult } from "@/lib/github/fileContents";
import { diffGraphs, type GraphDiff } from "./diffGraphs";
import type { DependencyGraph, GraphEdge, PRWithFiles, Readiness } from "./types";
import { withMergePlan } from "./mergePlan";
import { fetchReadiness, readinessCacheKey } from "@/lib/github/readiness";
import { parseRepoSettings, type RepoSettings } from "@/lib/repos/settings";
import { fetchOpenPRs } from "@/lib/github/fetchPRs";
import { fetchPRFiles } from "@/lib/github/fetchPRFiles";
import { toPRWithFiles } from "@/lib/github/mapToPR";
import { buildSharedDiff, mapWithConcurrency } from "@/lib/github/sharedDiffs";
import type { RepoRef, RawPR, RawPRFile } from "@/lib/github/types";
import { analyzeOrFallback } from "@/lib/ai/conflictAnalyzer";
import { getCachedGraph, setCachedGraph } from "@/lib/cache/graphCache";
import { invalidate } from "@/lib/cache/decorators";
import { prsCacheKey, filesCacheKey } from "@/lib/cache/githubCache";
import { redis } from "@/lib/cache/redis";
import { pushGraphUpdate } from "@/lib/websocket/server";
import { notifyUnblocked } from "@/lib/slack/notifyUnblocked";
import {
  graphRecomputes,
  recomputeDuration,
  mergeSimulations,
  recomputeCoalesced,
  readinessUpdates,
} from "@/lib/metrics";
import { publishCheckRuns } from "@/lib/bot/publishChecks";

/** Max concurrent AI analyses per recompute — bounds LLM fan-out without flooding the provider. */
const AI_CONCURRENCY = 4;
/** Upper bound on coalesced re-runs inside one lock hold (a webhook storm cannot pin a worker). */
const MAX_COALESCED_RERUNS = 3;
const LOCK_TTL_SECONDS = 60;

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
  /** The PR number from the triggering webhook, so we re-fetch exactly its files fresh. */
  changedPrNumber?: number;
  /** Manual sync: bypass ALL GitHub fetch caches for a fully fresh recompute. */
  forceFresh?: boolean;
}): Promise<RecomputeResult | null> {
  const repo = await prisma.repository.findUnique({
    where: { id: input.repoId },
    include: { installation: true },
  });
  if (!repo) return null;

  // Serialize recomputes per repo (graph:lock). If another recompute holds the lock, record this
  // event in the repo's dirty set instead of dropping it: the holder re-runs (re-fetching exactly
  // the PRs that changed) before it lets go, so no webhook is ever lost.
  const lockKey = `graph:lock:${input.repoId}`;
  const dirtyKey = `graph:dirty:${input.repoId}`;
  let current = input;
  let result: RecomputeResult | null = null;

  for (let pass = 0; pass <= MAX_COALESCED_RERUNS; pass++) {
    const locked = await redis.set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX");
    if (locked === null) {
      await redis.sadd(dirtyKey, current.changedPrNumber ? String(current.changedPrNumber) : "*");
      await redis.expire(dirtyKey, 600);
      return result;
    }
    try {
      await redis.del(dirtyKey); // this pass reflects everything queued so far
      result = (await runRecompute(repo, current)) ?? result;
    } finally {
      await redis.del(lockKey);
    }

    // Events that arrived while we were running: drain atomically and go again.
    const drained = (await redis.multi().smembers(dirtyKey).del(dirtyKey).exec()) ?? [];
    const members = (drained[0]?.[1] as string[] | undefined) ?? [];
    if (members.length === 0) return result;
    const prNumbers = members.filter((m) => m !== "*").map(Number);
    await invalidate(...prNumbers.map((n) => filesCacheKey(repo.id, n)));
    recomputeCoalesced.inc();
    current = { repoId: input.repoId, triggeredBy: `coalesced:${members.length}` };
  }
  return result;
}

type RepoRow = {
  id: number;
  fullName: string;
  defaultBranch: string;
  settings: unknown;
  installation: { githubInstallId: number };
};

async function runRecompute(
  repo: RepoRow,
  input: { repoId: number; triggeredBy: string; changedPrNumber?: number; forceFresh?: boolean },
): Promise<RecomputeResult | null> {
  const ref = toRepoRef(repo);
  const settings = parseRepoSettings(repo.settings);

  // Invalidate GitHub fetch caches so the recompute reflects current state, not a 2-5 min stale
  // snapshot (otherwise a merge/open isn't visible until the TTL expires). The PR list cache is
  // always dropped (the set of open PRs may have changed); the changed PR's files cache too.
  await invalidate(prsCacheKey(ref.id));
  if (input.changedPrNumber) await invalidate(filesCacheKey(ref.id, input.changedPrNumber));

  // 1. Fetch current open PRs + their files (fresh list above; per-PR files cached unless forced).
  const rawPRs = await fetchOpenPRs(ref);
  if (input.forceFresh && rawPRs.length) {
    await invalidate(...rawPRs.map((p) => filesCacheKey(ref.id, p.number)));
  }

  const enriched = await Promise.all(
    rawPRs.map(async (raw) => {
      const files = await fetchPRFiles(ref, raw.number);
      return { raw, files, pr: toPRWithFiles(raw, files) };
    }),
  );

  // 2. Build the graph (pure engine). Measure ONLY the engine (no GitHub I/O) so the SLO metric
  // and stored compute time reflect graph computation, not network latency (plan §11 Panel 2).
  const tEngine = Date.now();
  const deterministic = buildDependencyGraph(
    enriched.map((e) => e.pr),
    { ignoreGlobs: settings.ignoreGlobs, workspaceGlobs: settings.workspaceGlobs },
  );
  const computeTimeMs = Date.now() - tEngine;
  recomputeDuration.observe(computeTimeMs);
  graphRecomputes.inc({ trigger: input.triggeredBy.split(":")[0] });

  // 2b. Tier-2 deep verify: replay git's sequential merge (diff3) for approximate edges. Bounded and
  // best-effort — any failure leaves the edge approximate (and blocking).
  const verified = await deepVerify(ref, deterministic, enriched);

  // 2c. Optional AI refinement (Phase 2). Disabled by default; it may only demote approximate
  // evidence and never adds a blocking edge, so it can only ever soften the graph, never break it.
  const refined = await refineWithAI(verified, enriched, settings);

  // 2d. Readiness (CI / reviews / mergeable / branch rules — one GraphQL query) → merge plan.
  // Best-effort: without readiness the plan is pure topology.
  const readiness = await fetchReadiness(ref, repo.defaultBranch).catch(() => undefined);
  const graph = withMergePlan(refined, readiness);

  // 3. Diff against the previous snapshot.
  const prev = (await getCachedGraph(input.repoId)) ?? (await loadLatestSnapshotGraph(input.repoId));
  const diff = diffGraphs(prev, graph);

  // 4. Persist (PRs, files, dependency edges, snapshot).
  await persistGraph(input.repoId, enriched, graph, input.triggeredBy, computeTimeMs);

  // 5. Cache + push + notify.
  await setCachedGraph(input.repoId, graph);
  pushGraphUpdate(input.repoId, { graph, diff, syncedAt: new Date().toISOString(), reason: "recompute" });
  await notifyUnblocked(input.repoId, repo.fullName, diff, graph);
  if (settings.botEnabled) await publishCheckRuns(ref, graph, settings).catch(() => {});

  return { graph, computeTimeMs };
}

/**
 * Readiness fast path (CI / review / status webhooks): refetch readiness only, re-plan, and push —
 * edges are untouched, so no PR / file refetch and no engine run. Falls back to a full recompute
 * when there is no current graph to update.
 */
export async function refreshReadiness(repoId: number, trigger: string): Promise<DependencyGraph | null> {
  const repo = await prisma.repository.findUnique({ where: { id: repoId }, include: { installation: true } });
  if (!repo) return null;
  const current = (await getCachedGraph(repoId)) ?? (await loadLatestSnapshotGraph(repoId));
  if (!current) return (await recomputeGraph({ repoId, triggeredBy: `readiness:${trigger}` }))?.graph ?? null;

  const ref = toRepoRef(repo);
  const settings = parseRepoSettings(repo.settings);
  await invalidate(readinessCacheKey(repoId));
  const readiness = await fetchReadiness(ref, repo.defaultBranch);
  const graph = withMergePlan(current, readiness);
  readinessUpdates.inc({ trigger });

  await setCachedGraph(repoId, graph);
  await persistReadiness(repoId, readiness);
  pushGraphUpdate(repoId, { graph, diff: diffGraphs(current, graph), syncedAt: new Date().toISOString(), reason: "readiness" });
  if (settings.botEnabled) await publishCheckRuns(ref, graph, settings).catch(() => {});
  return graph;
}

async function persistReadiness(repoId: number, readiness: Map<string, Readiness>): Promise<void> {
  await prisma.$transaction(
    [...readiness.entries()].map(([number, r]) =>
      prisma.pullRequest.updateMany({
        where: { repoId, number: Number(number) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { readiness: r as any },
      }),
    ),
  );
}

/**
 * Tier-2 merge simulation for the most important approximate edges (blocking first). Fetches the
 * merge base, both heads and the base tip for each shared file (immutable, cached by SHA) and runs
 * the pure `simulateSequentialMerge`. Skips binary / oversized files and cross-base pairs.
 */
async function deepVerify(ref: RepoRef, graph: DependencyGraph, enriched: Enriched[]): Promise<DependencyGraph> {
  if (!env.MERGE_SIM_DEEP || env.MERGE_SIM_MAX_PAIRS === 0) return graph;
  const candidates = deepCandidates(graph, env.MERGE_SIM_MAX_PAIRS);
  if (candidates.length === 0) return graph;

  const byNumber = new Map(enriched.map((e) => [e.pr.number, e.pr]));
  const text = (r: BlobResult) => (r.kind === "text" ? r.content : null);
  const results: DeepResults = new Map();

  await mapWithConcurrency(candidates, AI_CONCURRENCY, async (edge) => {
    const a = byNumber.get(Number(edge.source));
    const b = byNumber.get(Number(edge.target));
    if (!a?.headSha || !b?.headSha || !a.baseRef || a.baseRef !== b.baseRef) {
      mergeSimulations.inc({ outcome: "skipped" });
      return;
    }
    try {
      const [ca, cb] = await Promise.all([
        getMergeContext(ref, a.baseRef, a.headSha),
        getMergeContext(ref, b.baseRef, b.headSha),
      ]);
      if (!ca || !cb) return;
      const perFile = new Map<string, DeepOutcome>();
      for (const c of edge.conflicts ?? []) {
        if (c.kind === "regenerable") continue;
        const blobs = await Promise.all(
          [ca.mergeBase, a.headSha, cb.mergeBase, b.headSha, ca.baseTip].map((sha) => getFileAt(ref, c.file, sha)),
        );
        if (blobs.some((r) => r.kind === "skip")) {
          mergeSimulations.inc({ outcome: "skipped" });
          continue;
        }
        const [mbA, hA, mbB, hB, tip] = blobs.map(text);
        const outcome = simulateSequentialMerge({ mergeBaseA: mbA, headA: hA, mergeBaseB: mbB, headB: hB, baseTip: tip });
        mergeSimulations.inc({ outcome: outcome.status });
        perFile.set(c.file, outcome);
      }
      if (perFile.size) results.set(edge.id, perFile);
    } catch {
      mergeSimulations.inc({ outcome: "error" });
    }
  });

  return applyDeepVerdicts(graph, results);
}

/**
 * Refine the deterministic graph with semantic verdicts when AI_ENABLED. Diffs come from the
 * already-fetched in-memory PR patches (no extra GitHub calls). Each edge is analyzed with bounded
 * concurrency via `analyzeOrFallback`, which never throws and respects the daily budget breaker.
 */
async function refineWithAI(
  graph: DependencyGraph,
  enriched: Enriched[],
  settings: RepoSettings,
): Promise<DependencyGraph> {
  const candidates = analyzableEdges(graph);
  if (!env.AI_ENABLED || !settings.aiEnabled || candidates.length === 0) return graph;

  const filesByNumber = new Map<number, PRWithFiles["files"]>(
    enriched.map((e) => [e.pr.number, e.pr.files]),
  );

  const verdicts = new Map<string, RefineVerdict>();
  await mapWithConcurrency(candidates, AI_CONCURRENCY, async (edge) => {
    const aFiles = filesByNumber.get(Number(edge.source));
    const bFiles = filesByNumber.get(Number(edge.target));
    if (!aFiles || !bFiles) return;
    // Shared files for overlap edges; def/ref files for cross-file symbol links.
    const aSide = [...new Set([...edge.sharedFiles, ...(edge.symbols ?? []).map((s) => s.defFile)])];
    const bSide = [...new Set([...edge.sharedFiles, ...(edge.symbols ?? []).map((s) => s.refFile)])];
    const verdict = await analyzeOrFallback({
      prA: Number(edge.source),
      prB: Number(edge.target),
      sharedFiles: edge.sharedFiles,
      diffA: buildSharedDiff(aFiles, aSide),
      diffB: buildSharedDiff(bFiles, bSide),
      focus: focusNotes(edge),
    });
    verdicts.set(edge.id, verdict);
  });

  return refineGraph(graph, verdicts);
}

/** Render the engine's findings for one edge as compact prompt notes (deterministic). */
function focusNotes(edge: GraphEdge): string | undefined {
  const lines: string[] = [];
  for (const c of edge.conflicts ?? []) {
    if (c.kind !== "overlap") continue;
    for (const r of c.regions.slice(0, 3)) {
      lines.push(`${c.file}: both PRs change base lines ${r.baseStart}-${Math.max(r.baseEnd, r.baseStart)}`);
    }
  }
  for (const s of edge.symbols ?? []) {
    lines.push(`#${edge.source} ${s.change} \`${s.name}\` (${s.defFile}); #${edge.target} references it in ${s.refFile}`);
  }
  return lines.length ? lines.join("\n") : undefined;
}

async function loadLatestSnapshotGraph(repoId: number): Promise<DependencyGraph | null> {
  const snap = await prisma.graphSnapshot.findFirst({
    where: { repoId },
    orderBy: { createdAt: "desc" },
  });
  return snap ? normalizeGraph(snap.graphJson) : null;
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
      const metadata = {
        draft: e.raw.draft ?? false,
        labels: (e.raw.labels ?? []).map((l) => l.name),
        reviewers: (e.raw.requested_reviewers ?? []).map((r) => r.login),
      };
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
          metadata,
          headSha: e.raw.head?.sha,
          baseSha: e.raw.base?.sha,
          headRef: e.raw.head?.ref,
          baseRef: e.raw.base?.ref,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          readiness: (graph.nodes.find((n) => n.id === String(e.raw.number))?.data.readiness ?? undefined) as any,
        },
        update: {
          headSha: e.raw.head?.sha,
          baseSha: e.raw.base?.sha,
          headRef: e.raw.head?.ref,
          baseRef: e.raw.base?.ref,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          readiness: (graph.nodes.find((n) => n.id === String(e.raw.number))?.data.readiness ?? undefined) as any,
          title: e.raw.title,
          authorLogin: e.raw.user?.login ?? "unknown",
          authorAvatar: e.raw.user?.avatar_url,
          additions,
          deletions,
          prUpdatedAt: new Date(e.raw.updated_at),
          metadata,
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
            patch: f.patch ?? null,
          })),
        });
      }
    }

    // Rebuild dependency edges from the computed graph.
    await tx.dependency.deleteMany({ where: { repoId } });
    const edges = graph.edges
      .filter((edge) => edge.type !== "INDIRECT") // derived on read, never persisted
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
          semanticVerdict: edge.semanticVerdict ?? null,
          explanation: edge.explanation ?? null,
          blocking: edge.blocking,
          severity: edge.severity,
          evidence: edge.evidence,
          certainty: edge.certainty,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          details: { conflicts: edge.conflicts ?? [], symbols: edge.symbols ?? [], resolution: edge.resolution } as any,
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

/** Current graph for a repo (cache → latest snapshot) — NO authorization; callers must authorize. */
export async function getCurrentGraph(repoId: number): Promise<DependencyGraph | null> {
  return (await getCachedGraph(repoId)) ?? (await loadLatestSnapshotGraph(repoId));
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

export interface SnapshotSummary {
  id: number;
  totalPRs: number;
  safePRs: number;
  blockedPRs: number;
  deadlockedPRs: number;
  totalEdges: number;
  triggeredBy: string;
  computeTimeMs: number;
  createdAt: Date;
}

/** Paginated snapshot history for a repo the user owns, or null if not owned. */
export async function getGraphHistory(
  repoId: number,
  userId: number,
  page: number,
  perPage: number,
): Promise<{ items: SnapshotSummary[]; page: number; perPage: number; total: number; hasNext: boolean } | null> {
  const repo = await prisma.repository.findFirst({
    where: { id: repoId, installation: { userId } },
    select: { id: true },
  });
  if (!repo) return null;

  const where = { repoId };
  const [total, snaps] = await Promise.all([
    prisma.graphSnapshot.count({ where }),
    prisma.graphSnapshot.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        totalPRs: true,
        safePRs: true,
        blockedPRs: true,
        deadlockedPRs: true,
        totalEdges: true,
        triggeredBy: true,
        computeTimeMs: true,
        createdAt: true,
      },
    }),
  ]);

  return { items: snaps, page, perPage, total, hasNext: page * perPage < total };
}

/**
 * One history entry + what changed since the snapshot before it (added / removed PRs, status
 * transitions). Null when the repo is not the user's or the snapshot does not exist.
 */
export async function getSnapshotDiff(
  repoId: number,
  userId: number,
  snapshotId: number,
): Promise<{ snapshot: SnapshotSummary; previousId: number | null; diff: GraphDiff } | null> {
  const snap = await prisma.graphSnapshot.findFirst({
    where: { id: snapshotId, repoId, repository: { installation: { userId } } },
  });
  if (!snap) return null;
  const prev = await prisma.graphSnapshot.findFirst({
    where: { repoId, createdAt: { lt: snap.createdAt } },
    orderBy: { createdAt: "desc" },
  });
  const next = normalizeGraph(snap.graphJson);
  if (!next) return null;
  const { graphJson: _g, mergeOrder: _m, repoId: _r, ...summary } = snap;
  void _g;
  void _m;
  void _r;
  return {
    snapshot: summary,
    previousId: prev?.id ?? null,
    diff: diffGraphs(prev ? normalizeGraph(prev.graphJson) : null, next),
  };
}

/** Server-component initial fetch by owner/name. Returns the graph + repoId, or null. */
export async function getInitialGraph(
  owner: string,
  name: string,
  userId: number,
): Promise<{ repoId: number; graph: DependencyGraph | null; lastSyncAt: string | null } | null> {
  // Scoped to the viewer's installations — a repo connected by someone else is a 404, not a leak.
  const repo = await prisma.repository.findFirst({
    where: { fullName: `${owner}/${name}`, installation: { userId } },
    select: { id: true, lastSyncAt: true },
  });
  if (!repo) return null;
  const graph = (await getCachedGraph(repo.id)) ?? (await loadLatestSnapshotGraph(repo.id));
  return { repoId: repo.id, graph, lastSyncAt: repo.lastSyncAt?.toISOString() ?? null };
}
