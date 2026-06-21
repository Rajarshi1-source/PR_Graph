export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  /** Return false to stop retrying a given error (e.g. 4xx). */
  shouldRetry?: (err: unknown) => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry with exponential backoff + full jitter (Retry pattern, plan §13). */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseMs = 200, maxMs = 3000, factor = 2, shouldRetry = () => true } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) break;
      const backoff = Math.min(maxMs, baseMs * factor ** attempt);
      await sleep(Math.random() * backoff); // full jitter
    }
  }
  throw lastErr;
}

/** Don't retry GitHub 4xx (except 429) — they won't get better on retry. */
export function isRetryableHttp(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === undefined) return true; // network errors etc.
  if (status === 429) return true;
  return status >= 500;
}
