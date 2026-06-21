import { withCache } from "@/lib/cache/decorators";
import { recordRateLimit, prsCacheKey, getEtag, setEtag } from "@/lib/cache/githubCache";
import { retry, isRetryableHttp } from "@/lib/resilience/retry";
import { withTimeout } from "@/lib/resilience/timeout";
import { fireGithub } from "@/lib/resilience/breakers";
import { redis } from "@/lib/cache/redis";
import { githubQuotaRemaining } from "@/lib/metrics";
import { octokitFor } from "./client";
import type { RepoRef, RawPR } from "./types";

/** Durable (etag-paired) copy of the list, reused on a 304 even after the short cache expires. */
const prsDataKey = (repoId: number) => `gh:prsdata:${repoId}`;

/**
 * Fetch all open PRs for a repo. Two-tier caching to stay under the GitHub quota (5,000 req/hr
 * per installation): a 2-min response cache, plus an ETag conditional request so an unchanged
 * list returns 304 (which does NOT count against the rate limit) and we serve the durable copy.
 */
export const fetchOpenPRs = withCache(
  (repo: RepoRef) => prsCacheKey(repo.id),
  120,
  async (repo: RepoRef): Promise<RawPR[]> => {
    const octokit = octokitFor(repo.installationId);
    const scope = `prs:${repo.id}`;
    const etag = await getEtag(scope);

    try {
      const first = await fireGithub(() =>
        retry(
          () =>
            withTimeout(
              octokit.request("GET /repos/{owner}/{repo}/pulls", {
                owner: repo.owner,
                repo: repo.name,
                state: "open",
                per_page: 100,
                page: 1,
                headers: etag ? { "if-none-match": etag } : {},
              }),
              20_000,
              "github.pulls.list",
            ),
          { shouldRetry: isRetryableHttp },
        ),
      );

      if (first.headers.etag) await setEtag(scope, first.headers.etag);

      let prs = first.data as unknown as RawPR[];
      if (first.data.length === 100) {
        // >100 open PRs: fall back to full pagination (conditional only covers page 1).
        prs = (await fireGithub(() =>
          retry(
            () =>
              withTimeout(
                octokit.paginate(octokit.rest.pulls.list, {
                  owner: repo.owner,
                  repo: repo.name,
                  state: "open",
                  per_page: 100,
                }),
                20_000,
                "github.pulls.list.all",
              ),
            { shouldRetry: isRetryableHttp },
          ),
        )) as unknown as RawPR[];
      }

      await redis.set(prsDataKey(repo.id), JSON.stringify(prs), "EX", 3600);

      // Best-effort rate-limit governor read.
      try {
        const { data } = await octokit.rest.rateLimit.get();
        await recordRateLimit(repo.installationId, data.rate.remaining);
        githubQuotaRemaining.set({ installation: String(repo.installationId) }, data.rate.remaining);
      } catch {
        /* non-critical */
      }

      return prs;
    } catch (err) {
      // 304 Not Modified — list unchanged; serve the durable copy (no quota spent).
      if ((err as { status?: number }).status === 304) {
        const cached = await redis.get(prsDataKey(repo.id));
        if (cached) return JSON.parse(cached) as RawPR[];
        return [];
      }
      throw err;
    }
  },
);
