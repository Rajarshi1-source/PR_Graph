import { fetchPRFiles } from "./fetchPRFiles";
import type { RepoRef } from "./types";

/**
 * For an overlapping edge, return the diff hunks of the shared files for each PR. The AI
 * analyzer (Phase 2) consumes these — it never calls GitHub itself (PRGraph_eval_connectors.md §3).
 */
export async function sharedDiffs(
  repo: RepoRef,
  prA: number,
  prB: number,
  sharedFiles: string[],
): Promise<{ diffA: string; diffB: string }> {
  const pick = async (pr: number) => {
    const files = await fetchPRFiles(repo, pr);
    return files
      .filter((f) => sharedFiles.includes(f.filename))
      .map((f) => f.patch ?? "")
      .join("\n");
  };
  return { diffA: await pick(prA), diffB: await pick(prB) };
}
