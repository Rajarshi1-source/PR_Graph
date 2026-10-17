/**
 * Thin HTTP client for the PRGraph machine API (`/api/v1/**`). No state, no caching — the server
 * owns the graph; this package only asks questions about it.
 */

export interface PreflightRequest {
  repo: string;
  patch?: string;
  files?: { path: string; ranges?: [number, number][] }[];
  baseSha?: string;
}

export interface PreflightCollision {
  pr: { number: number; title: string; url: string; author: string; status: string };
  kind: "BLOCKS" | "TOUCHES" | "SEMANTIC";
  direction: "wait" | "affects";
  blocking: boolean;
  files: string[];
  regions: { file: string; baseStart: number; baseEnd: number }[];
  symbols: { name: string; change: string; defFile: string; refFile: string }[];
}

export interface PreflightResponse {
  risk: "none" | "low" | "high";
  collisions: PreflightCollision[];
  waitFor: number[];
  recommendation: string;
  graphVersion?: number;
}

export class PrgraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  /** Use the public demo endpoint (no token) — for trying the tools out. */
  demo?: boolean;
}

export class PrgraphClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  preflight(body: PreflightRequest): Promise<PreflightResponse> {
    const path = this.opts.demo ? "/api/demo/preflight" : "/api/v1/preflight";
    return this.request<PreflightResponse>(path, { method: "POST", body: JSON.stringify(body) });
  }

  graph(repo: string): Promise<GraphPayload> {
    return this.request<GraphPayload>(`/api/v1/repos/${encodeRepo(repo)}/graph`);
  }

  mergePlanMarkdown(repo: string): Promise<string> {
    return this.request<string>(`/api/v1/repos/${encodeRepo(repo)}/merge-plan?format=markdown`, {}, "text");
  }

  private async request<T>(path: string, init: RequestInit = {}, as: "json" | "text" = "json"): Promise<T> {
    if (!this.opts.demo && !this.opts.token) {
      throw new PrgraphError("PRGRAPH_TOKEN is not set (create one in the repo's PRGraph settings)", 401);
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(this.opts.token && !this.opts.demo ? { authorization: `Bearer ${this.opts.token}` } : {}),
      },
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const problem = (await res.json()) as { detail?: string };
        detail = problem.detail ?? detail;
      } catch {
        /* non-JSON error body */
      }
      throw new PrgraphError(`PRGraph API ${res.status}: ${detail}`, res.status);
    }
    return (as === "text" ? await res.text() : await res.json()) as T;
  }
}

/** The subset of the graph DTO the tools read. */
export interface GraphPayload {
  nodes: { id: string; data: { prNumber: number; title: string; author: string; status: string; htmlUrl: string; blockedBy: string[]; blocking: string[] } }[];
  edges: {
    source: string;
    target: string;
    type: string;
    blocking: boolean;
    sharedFiles: string[];
    conflicts?: { file: string; kind: string; regions: { baseStart: number; baseEnd: number }[] }[];
    symbols?: { name: string; change: string; defFile: string; refFile: string }[];
    explanation?: string;
    resolution?: string;
  }[];
  stats: Record<string, number>;
}

const encodeRepo = (repo: string) => repo.split("/").map(encodeURIComponent).join("/");
