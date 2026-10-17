import crypto from "node:crypto";
import { redis } from "@/lib/cache/redis";
import { retry, isRetryableHttp } from "@/lib/resilience/retry";
import { withTimeout } from "@/lib/resilience/timeout";
import { fireGithub } from "@/lib/resilience/breakers";
import { octokitFor } from "./client";
import type { RepoRef } from "./types";

/** Files larger than this are never simulated (and never cached). */
export const MAX_SIM_FILE_BYTES = 1_000_000;
/** Blobs up to this size are cached — content at a SHA is immutable, so the TTL is long. */
const MAX_CACHED_BLOB_BYTES = 256_000;
const BLOB_TTL_SECONDS = 7 * 24 * 3600;

export interface MergeContext {
  /** Merge base of the PR head and its base branch (what the PR diff is relative to). */
  mergeBase: string;
  /** Current tip of the base branch. */
  baseTip: string;
}

const call = <T>(label: string, thunk: () => Promise<T>) =>
  fireGithub(() => retry(() => withTimeout(thunk(), 20_000, label), { shouldRetry: isRetryableHttp }));

/**
 * Merge base + base tip for a PR via `compareCommitsWithBasehead(baseRef...headSha)`. Cached
 * 10 min per (baseRef, headSha): the merge base is stable for a head SHA; the tip moves slowly
 * and a slightly stale tip only makes the simulation conservative.
 */
export async function getMergeContext(
  repo: RepoRef,
  baseRef: string,
  headSha: string,
): Promise<MergeContext | null> {
  const key = `gh:mergectx:${repo.id}:${baseRef}:${headSha}`;
  const hit = await redis.get(key).catch(() => null);
  if (hit) return JSON.parse(hit) as MergeContext;

  const octokit = octokitFor(repo.installationId);
  const { data } = await call("github.compare", () =>
    octokit.rest.repos.compareCommitsWithBasehead({
      owner: repo.owner,
      repo: repo.name,
      basehead: `${baseRef}...${headSha}`,
      per_page: 1,
    }),
  );
  const ctx: MergeContext | null =
    data.merge_base_commit?.sha && data.base_commit?.sha
      ? { mergeBase: data.merge_base_commit.sha, baseTip: data.base_commit.sha }
      : null;
  if (ctx) await redis.set(key, JSON.stringify(ctx), "EX", 600).catch(() => {});
  return ctx;
}

export type BlobResult = { kind: "text"; content: string } | { kind: "absent" } | { kind: "skip" };

/**
 * File content at a commit. `absent` = the file does not exist at that ref (404); `skip` = binary
 * or too large to simulate. Cached by (path, sha) because content at a SHA never changes.
 */
export async function getFileAt(repo: RepoRef, path: string, sha: string): Promise<BlobResult> {
  const key = `gh:blob:${repo.id}:${sha}:${crypto.createHash("sha256").update(path).digest("hex").slice(0, 32)}`;
  const hit = await redis.get(key).catch(() => null);
  if (hit) return JSON.parse(hit) as BlobResult;

  const octokit = octokitFor(repo.installationId);
  let result: BlobResult;
  try {
    const { data } = await call("github.getContent", () =>
      octokit.rest.repos.getContent({ owner: repo.owner, repo: repo.name, path, ref: sha }),
    );
    if (Array.isArray(data) || data.type !== "file" || data.size > MAX_SIM_FILE_BYTES || !("content" in data)) {
      result = { kind: "skip" };
    } else {
      const buf = Buffer.from(data.content ?? "", (data.encoding as BufferEncoding) || "base64");
      result = buf.includes(0) ? { kind: "skip" } : { kind: "text", content: buf.toString("utf8") };
    }
  } catch (err) {
    if ((err as { status?: number }).status === 404) result = { kind: "absent" };
    else throw err;
  }

  const size = result.kind === "text" ? result.content.length : 0;
  if (size <= MAX_CACHED_BLOB_BYTES) {
    await redis.set(key, JSON.stringify(result), "EX", BLOB_TTL_SECONDS).catch(() => {});
  }
  return result;
}
