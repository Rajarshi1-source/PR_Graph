/** Reference to a connected repo, enough to authenticate + call the GitHub API. */
export interface RepoRef {
  id: number; // our DB Repository.id
  owner: string;
  name: string;
  installationId: number; // GitHub App installation id
}

/** Minimal shape we read from `pulls.list`. */
export interface RawPR {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
  id: number;
  draft?: boolean;
  labels?: { name: string }[];
  requested_reviewers?: { login: string }[] | null;
}

/** Minimal shape we read from `pulls.listFiles` (includes the unified-diff `patch`). */
export interface RawPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}
