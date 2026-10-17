import { redis } from "@/lib/cache/redis";
import { retry, isRetryableHttp } from "@/lib/resilience/retry";
import { withTimeout } from "@/lib/resilience/timeout";
import { fireGithub } from "@/lib/resilience/breakers";
import { octokitFor } from "./client";
import type { RepoRef } from "./types";
import {
  toReadiness,
  EMPTY_RULES,
  type BranchRules,
  type CheckSignal,
  type RawReadiness,
} from "@/lib/graph/readiness";
import type { Readiness } from "@/lib/graph/types";

/**
 * ONE paginated GraphQL query fetches readiness for every open PR (draft, mergeable,
 * reviewDecision — which already accounts for required reviews — and the last commit's
 * statusCheckRollup). Versus REST this is ~1 request per 50 PRs instead of ~3 per PR.
 */
const READINESS_QUERY = /* GraphQL */ `
  query PRGraphReadiness($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, first: 50, after: $cursor, orderBy: { field: CREATED_AT, direction: ASC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          headRefOid
          isDraft
          mergeable
          reviewDecision
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  contexts(first: 100) {
                    nodes {
                      __typename
                      ... on CheckRun { name status conclusion }
                      ... on StatusContext { context state }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type CheckNode =
  | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null }
  | { __typename: "StatusContext"; context: string; state: string };

interface ReadinessPage {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        number: number;
        headRefOid: string;
        isDraft: boolean;
        mergeable: RawReadiness["mergeable"];
        reviewDecision: RawReadiness["reviewDecision"];
        commits: {
          nodes: { commit: { statusCheckRollup: { contexts: { nodes: CheckNode[] } } | null } }[];
        };
      }[];
    };
  } | null;
}

const FAILING = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const PASSING = new Set(["SUCCESS"]);
const NEUTRAL = new Set(["NEUTRAL", "SKIPPED", "STALE"]);

/** Normalize a CheckRun / StatusContext node. Exported for tests. */
export function toCheckSignal(n: CheckNode): CheckSignal {
  if (n.__typename === "CheckRun") {
    if (n.status !== "COMPLETED") return { name: n.name, state: "pending" };
    const c = (n.conclusion ?? "").toUpperCase();
    return { name: n.name, state: FAILING.has(c) ? "failure" : PASSING.has(c) ? "success" : NEUTRAL.has(c) ? "neutral" : "pending" };
  }
  const s = n.state.toUpperCase();
  return { name: n.context, state: FAILING.has(s) ? "failure" : PASSING.has(s) ? "success" : "pending" };
}

const call = <T>(label: string, thunk: () => Promise<T>) =>
  fireGithub(() => retry(() => withTimeout(thunk(), 20_000, label), { shouldRetry: isRetryableHttp }));

/** Default-branch rules via the rulesets API (metadata permission only). Cached 10 min. */
export async function fetchBranchRules(repo: RepoRef, branch: string): Promise<BranchRules> {
  const key = `gh:rules:${repo.id}:${branch}`;
  const hit = await redis.get(key).catch(() => null);
  if (hit) return JSON.parse(hit) as BranchRules;

  const octokit = octokitFor(repo.installationId);
  let rules: BranchRules = EMPTY_RULES;
  try {
    const { data } = await call("github.branchRules", () =>
      octokit.request("GET /repos/{owner}/{repo}/rules/branches/{branch}", {
        owner: repo.owner,
        repo: repo.name,
        branch,
        per_page: 100,
      }),
    );
    const list = data as { type: string; parameters?: Record<string, unknown> }[];
    const requiredChecks = list
      .filter((r) => r.type === "required_status_checks")
      .flatMap((r) => ((r.parameters?.required_status_checks as { context: string }[]) ?? []).map((c) => c.context));
    const requiredApprovals = Math.max(
      0,
      ...list
        .filter((r) => r.type === "pull_request")
        .map((r) => Number(r.parameters?.required_approving_review_count ?? 0)),
    );
    rules = {
      requiredChecks: [...new Set(requiredChecks)].sort(),
      requiredApprovals,
      mergeQueue: list.some((r) => r.type === "merge_queue"),
      // Rulesets are fully visible with metadata permission; classic protection is not.
      complete: false,
    };
  } catch {
    rules = EMPTY_RULES; // rules are advisory — never fail readiness on them
  }
  await redis.set(key, JSON.stringify(rules), "EX", 600).catch(() => {});
  return rules;
}

export const readinessCacheKey = (repoId: number) => `gh:readiness:${repoId}`;

/**
 * Readiness for every open PR, keyed by PR number (as string ids, matching graph node ids).
 * Cached 60 s; the readiness webhooks (check_*, status, pull_request_review) invalidate it.
 */
export async function fetchReadiness(repo: RepoRef, defaultBranch: string): Promise<Map<string, Readiness>> {
  const key = readinessCacheKey(repo.id);
  const hit = await redis.get(key).catch(() => null);
  if (hit) return new Map(JSON.parse(hit) as [string, Readiness][]);

  const octokit = octokitFor(repo.installationId);
  const rules = await fetchBranchRules(repo, defaultBranch);
  const out = new Map<string, Readiness>();
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const res: ReadinessPage = await call("github.graphql.readiness", () =>
      octokit.graphql<ReadinessPage>(READINESS_QUERY, { owner: repo.owner, name: repo.name, cursor }),
    );
    const prs = res.repository?.pullRequests;
    if (!prs) break;
    for (const n of prs.nodes) {
      const contexts = n.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
      out.set(
        String(n.number),
        toReadiness(
          {
            number: n.number,
            headSha: n.headRefOid,
            isDraft: n.isDraft,
            mergeable: n.mergeable,
            reviewDecision: n.reviewDecision,
            checks: contexts.map(toCheckSignal),
          },
          rules,
        ),
      );
    }
    if (!prs.pageInfo.hasNextPage) break;
    cursor = prs.pageInfo.endCursor;
  }
  await redis.set(key, JSON.stringify([...out.entries()]), "EX", 60).catch(() => {});
  return out;
}
