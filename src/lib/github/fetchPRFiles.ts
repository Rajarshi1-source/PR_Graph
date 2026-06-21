import { withCache } from "@/lib/cache/decorators";
import { retry, isRetryableHttp } from "@/lib/resilience/retry";
import { withTimeout } from "@/lib/resilience/timeout";
import { octokitFor } from "./client";
import type { RepoRef, RawPRFile } from "./types";

/**
 * Fetch the changed files for one PR (paginated). The `patch` field carries the unified-diff
 * hunks consumed by the AI analyzer (Phase 2). Cached 5 min.
 */
export const fetchPRFiles = withCache(
  (repo: RepoRef, prNumber: number) => `gh:files:${repo.id}:${prNumber}`,
  300,
  async (repo: RepoRef, prNumber: number): Promise<RawPRFile[]> => {
    const octokit = octokitFor(repo.installationId);
    return (await retry(
      () =>
        withTimeout(
          octokit.paginate(octokit.rest.pulls.listFiles, {
            owner: repo.owner,
            repo: repo.name,
            pull_number: prNumber,
            per_page: 100,
          }),
          20_000,
          "github.pulls.listFiles",
        ),
      { shouldRetry: isRetryableHttp },
    )) as unknown as RawPRFile[];
  },
);
