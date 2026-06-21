import type { PRFile } from "@/lib/graph/types";

/**
 * Derive the diff text the AI analyzer needs for a single edge from the PR files **already fetched**
 * during the recompute — no extra GitHub calls (patches are persisted/fetched alongside the file
 * list). We concatenate only the patches for the files shared by the two PRs, in a stable order so
 * the content-addressed cache key is deterministic.
 */
export function buildSharedDiff(files: PRFile[], sharedFiles: string[]): string {
  const shared = new Set(sharedFiles);
  return files
    .filter((f) => shared.has(f.filename) && f.patch)
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map((f) => `### ${f.filename}\n${f.patch}`)
    .join("\n\n");
}

/**
 * Run `task` over `items` with at most `concurrency` in flight. Tiny local limiter so the AI
 * refinement can fan out across edges without flooding the LLM provider — avoids an extra dep.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await task(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
