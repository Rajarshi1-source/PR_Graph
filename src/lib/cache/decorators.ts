import { redis } from "./redis";

/**
 * Cache-aside higher-order wrapper. Wraps an async function so its result is cached in
 * Redis (JSON) under a content key for `ttlSeconds`. Used by the GitHub service to stay
 * under the API rate limit (backend skill).
 *
 *   export const fetchOpenPRs = withCache((repo) => `gh:prs:${repo.id}`, 120, async (repo) => {...});
 */
export function withCache<A extends unknown[], R>(
  keyFn: (...args: A) => string,
  ttlSeconds: number,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const key = keyFn(...args);
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as R;
    const value = await fn(...args);
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    return value;
  };
}

/** Invalidate one or more cache keys. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length) await redis.del(...keys);
}
