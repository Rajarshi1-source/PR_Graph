import { redis } from "./redis";

/**
 * GitHub-specific cache helpers: ETag storage (a 304 doesn't count against quota) and the
 * rate-limit governor (security-and-api.md §A.6). Below the threshold the GitHub service
 * extends TTLs and defers non-critical syncs.
 */
const RATE_LIMIT_FLOOR = 500;

const etagKey = (scope: string) => `gh:etag:${scope}`;
const rateKey = (installId: number) => `gh:ratelimit:${installId}`;

/** Cache-key helpers shared by the GitHub fetchers and the recompute service (single source). */
export const prsCacheKey = (repoId: number) => `gh:prs:${repoId}`;
export const filesCacheKey = (repoId: number, prNumber: number) => `gh:files:${repoId}:${prNumber}`;

export async function getEtag(scope: string): Promise<string | null> {
  return redis.get(etagKey(scope));
}

export async function setEtag(scope: string, etag: string, ttlSeconds = 3600): Promise<void> {
  await redis.set(etagKey(scope), etag, "EX", ttlSeconds);
}

export async function recordRateLimit(installId: number, remaining: number): Promise<void> {
  await redis.set(rateKey(installId), String(remaining), "EX", 3600);
}

export async function getRateLimitRemaining(installId: number): Promise<number | null> {
  const v = await redis.get(rateKey(installId));
  return v === null ? null : Number(v);
}

/** True when we should conserve quota (extend TTLs, defer non-critical syncs). */
export async function shouldConserveQuota(installId: number): Promise<boolean> {
  const remaining = await getRateLimitRemaining(installId);
  return remaining !== null && remaining < RATE_LIMIT_FLOOR;
}
