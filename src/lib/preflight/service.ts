import { prisma } from "@/lib/db/prisma";
import { getGraphVersion } from "@/lib/cache/graphCache";
import { getCurrentGraph } from "@/lib/graph/service";
import { preflight, type PreflightCandidate, type PreflightResult } from "@/lib/graph/preflight";
import type { PRWithFiles } from "@/lib/graph/types";
import { parseRepoSettings } from "@/lib/repos/settings";
import { preflightRequests } from "@/lib/metrics";

/**
 * Preflight against the STORED open-PR facts (Postgres: PR rows + file patches) — never calls
 * GitHub on the request path, so it is fast and costs no API quota.
 */
export async function runPreflight(
  repoId: number,
  candidate: PreflightCandidate,
): Promise<(PreflightResult & { graphVersion: number }) | null> {
  const repo = await prisma.repository.findUnique({ where: { id: repoId }, select: { settings: true } });
  if (!repo) return null;
  const settings = parseRepoSettings(repo.settings);

  const rows = await prisma.pullRequest.findMany({
    where: { repoId, state: "open" },
    include: { files: { select: { filename: true, patch: true, status: true, additions: true, deletions: true } } },
    orderBy: { number: "asc" },
  });
  const prs: PRWithFiles[] = rows.map((r) => ({
    number: r.number,
    title: r.title,
    author: r.authorLogin,
    createdAt: r.prCreatedAt.toISOString(),
    htmlUrl: r.htmlUrl,
    headSha: r.headSha ?? undefined,
    baseSha: r.baseSha ?? undefined,
    headRef: r.headRef ?? undefined,
    baseRef: r.baseRef ?? undefined,
    files: r.files.map((f) => ({ ...f, patch: f.patch ?? undefined })),
  }));

  const graph = await getCurrentGraph(repoId);
  const status = new Map((graph?.nodes ?? []).map((n) => [n.data.prNumber, n.data.status]));
  const result = preflight(prs, candidate, { statusOf: (n) => status.get(n), ignoreGlobs: settings.ignoreGlobs });
  preflightRequests.inc({ risk: result.risk, source: "api" });
  return { ...result, graphVersion: await getGraphVersion(repoId).catch(() => 0) };
}
