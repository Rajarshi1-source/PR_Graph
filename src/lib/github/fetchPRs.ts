import { withCache } from "@/lib/cache/decorators";
import { recordRateLimit } from "@/lib/cache/githubCache";
import { retry, isRetryableHttp } from "@/lib/resilience/retry";
import { withTimeout } from "@/lib/resilience/timeout";
import { octokitFor } from "./client";
import type { RepoRef, RawPR } from "./types";

/**
 * Fetch all open PRs for a repo (paginated). Cached 2 min to stay under the GitHub quota
 * (5,000 req/hr per installation; a 50-PR sync is ~51 calls). Always uses octokit.paginate.
 */
export const fetchOpenPRs = withCache(
  (repo: RepoRef) => `gh:prs:${repo.id}`,
  120,
  async (repo: RepoRef): Promise<RawPR[]> => {
    const octokit = octokitFor(repo.installationId);
    const prs = (await retry(
      () =>
        withTimeout(
          octokit.paginate(octokit.rest.pulls.list, {
            owner: repo.owner,
            repo: repo.name,
            state: "open",
            per_page: 100,
          }),
          20_000,
          "github.pulls.list",
        ),
      { shouldRetry: isRetryableHttp },
    )) as unknown as RawPR[];

    // Best-effort rate-limit governor read.
    try {
      const { data } = await octokit.rest.rateLimit.get();
      await recordRateLimit(repo.installationId, data.rate.remaining);
    } catch {
      /* non-critical */
    }

    return prs;
  },
);
