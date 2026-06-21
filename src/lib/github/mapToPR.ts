import type { PRWithFiles, PRFile } from "@/lib/graph/types";
import { fetchOpenPRs } from "./fetchPRs";
import { fetchPRFiles } from "./fetchPRFiles";
import type { RepoRef, RawPR, RawPRFile } from "./types";

/** Map a raw GitHub PR + its files into the engine's normalized input shape. */
export function toPRWithFiles(pr: RawPR, files: RawPRFile[]): PRWithFiles {
  return {
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? "unknown",
    authorAvatar: pr.user?.avatar_url,
    createdAt: pr.created_at,
    htmlUrl: pr.html_url,
    files: files.map(
      (f): PRFile => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      }),
    ),
  };
}

/**
 * Fetch all open PRs + their files for a repo and return engine-ready inputs.
 * Files per PR are fetched in parallel (each is independently cached).
 */
export async function fetchPRsWithFiles(repo: RepoRef): Promise<PRWithFiles[]> {
  const prs = await fetchOpenPRs(repo);
  return Promise.all(
    prs.map(async (pr) => {
      const files = await fetchPRFiles(repo, pr.number);
      return toPRWithFiles(pr, files);
    }),
  );
}
