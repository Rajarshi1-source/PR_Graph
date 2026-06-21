import { withCache } from "@/lib/cache/decorators";
import { filesCacheKey } from "@/lib/cache/githubCache";
import { retry, isRetryableHttp } from "@/lib/resilience/retry";
import { withTimeout } from "@/lib/resilience/timeout";
import { fireGithub } from "@/lib/resilience/breakers";
import { octokitFor } from "./client";
import type { RepoRef, RawPRFile } from "./types";

/**
 * Fetch the changed files for one PR (paginated). The `patch` field carries the unified-diff
 * hunks consumed by the AI analyzer (Phase 2). Cached 5 min.
 */
export const fetchPRFiles = withCache(
  (repo: RepoRef, prNumber: number) => filesCacheKey(repo.id, prNumber),
  300,
  async (repo: RepoRef, prNumber: number): Promise<RawPRFile[]> => {
    const octokit = octokitFor(repo.installationId);
    return (await fireGithub(() =>
      retry(
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
      ),
    )) as unknown as RawPRFile[];
  },
);
