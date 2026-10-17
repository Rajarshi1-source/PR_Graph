import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { octokitFor } from "@/lib/github/client";
import { fireGithub } from "@/lib/resilience/breakers";
import { retry, isRetryableHttp } from "@/lib/resilience/retry";
import { withTimeout } from "@/lib/resilience/timeout";
import { mapWithConcurrency } from "@/lib/github/sharedDiffs";
import { checkRunWrites } from "@/lib/metrics";
import type { RepoRef } from "@/lib/github/types";
import type { DependencyGraph } from "@/lib/graph/types";
import type { RepoSettings } from "@/lib/repos/settings";
import { renderCheckSummary } from "./renderCheckSummary";

export const CHECK_NAME = "PRGraph";
export const RECHECK_ACTION = "recompute";
const CONCURRENCY = 4;

const call = <T>(label: string, thunk: () => Promise<T>) =>
  fireGithub(() => retry(() => withTimeout(thunk(), 15_000, label), { shouldRetry: isRetryableHttp }));

/**
 * Publish the `PRGraph` Check Run on every open PR (opt-in per repo). Idempotent: the rendered
 * summary + conclusion are content-hashed and compared with the `check_runs` row for
 * (repo, PR, head SHA) — unchanged content is never re-written, which keeps GitHub's secondary
 * rate limits safe and makes retries / multiple replicas harmless.
 */
export async function publishCheckRuns(
  ref: RepoRef,
  graph: DependencyGraph,
  settings: Pick<RepoSettings, "failOnConflict">,
): Promise<{ written: number; skipped: number }> {
  const octokit = octokitFor(ref.installationId);
  const fullName = `${ref.owner}/${ref.name}`;
  let written = 0;
  let skipped = 0;

  await mapWithConcurrency(
    graph.nodes.filter((n) => n.data.headSha),
    CONCURRENCY,
    async (node) => {
      const headSha = node.data.headSha!;
      const prNumber = node.data.prNumber;
      const out = renderCheckSummary(node, graph, {
        failOnConflict: settings.failOnConflict,
        appUrl: env.APP_URL,
        fullName,
      });
      const hash = crypto
        .createHash("sha256")
        .update(`${out.conclusion}\u0000${out.title}\u0000${out.summary}`)
        .digest("hex");

      const existing = await prisma.checkRun.findUnique({
        where: { repoId_prNumber_headSha: { repoId: ref.id, prNumber, headSha } },
      });
      if (existing?.summaryHash === hash) {
        skipped++;
        checkRunWrites.inc({ result: "skipped" });
        return;
      }

      const body = {
        owner: ref.owner,
        repo: ref.name,
        name: CHECK_NAME,
        head_sha: headSha,
        status: "completed" as const,
        conclusion: out.conclusion,
        output: { title: out.title, summary: out.summary },
        actions: [{ label: "Re-check", description: "Recompute PR dependencies", identifier: RECHECK_ACTION }],
      };

      try {
        let checkRunId: bigint;
        if (existing) {
          await call("github.checks.update", () =>
            octokit.rest.checks.update({ ...body, check_run_id: Number(existing.checkRunId) }),
          );
          checkRunId = existing.checkRunId;
        } else {
          const { data } = await call("github.checks.create", () => octokit.rest.checks.create(body));
          checkRunId = BigInt(data.id);
        }
        await prisma.checkRun.upsert({
          where: { repoId_prNumber_headSha: { repoId: ref.id, prNumber, headSha } },
          create: { repoId: ref.id, prNumber, headSha, checkRunId, summaryHash: hash },
          update: { checkRunId, summaryHash: hash },
        });
        written++;
        checkRunWrites.inc({ result: existing ? "updated" : "created" });
      } catch (err) {
        checkRunWrites.inc({ result: "error" });
        console.warn(`[bot] check run for #${prNumber} failed (non-fatal):`, (err as Error).message);
      }
    },
  );

  return { written, skipped };
}
