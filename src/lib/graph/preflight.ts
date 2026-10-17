import type { NodeStatus, PRFile, PRWithFiles, SymbolLink } from "./types";
import { buildDependencyGraph } from "./buildDependencyGraph";
import { splitMultiFileDiff } from "./patch/parsePatch";
import { symbolFacts } from "./symbols/impact";

/** A change that does not exist as a PR yet (an agent's working tree, a CI branch, a draft). */
export interface PreflightCandidate {
  /** Unified diff (e.g. `git diff origin/main...HEAD`). */
  patch?: string;
  /** Or a plain file list, optionally with base-line ranges `[start, end]` that will change. */
  files?: { path: string; ranges?: [number, number][] }[];
  baseSha?: string;
}

export type PreflightKind = "BLOCKS" | "TOUCHES" | "SEMANTIC";

export interface PreflightCollision {
  pr: { number: number; title: string; url: string; author: string; status: NodeStatus | "UNKNOWN" };
  kind: PreflightKind;
  /** `wait`: that PR should merge first · `affects`: your change breaks something that PR uses. */
  direction: "wait" | "affects";
  blocking: boolean;
  files: string[];
  regions: { file: string; baseStart: number; baseEnd: number }[];
  symbols: SymbolLink[];
}

export interface PreflightResult {
  risk: "none" | "low" | "high";
  collisions: PreflightCollision[];
  /** PRs to wait for (blocking collisions where the other PR should land first). */
  waitFor: number[];
  recommendation: string;
}

export const CANDIDATE = 0;
const FUTURE = "9999-12-31T00:00:00Z"; // the candidate is always the newest change

/** Turn a preflight request into a virtual PR the engine understands. Pure. */
export function candidatePR(c: PreflightCandidate): PRWithFiles {
  const files: PRFile[] = [];
  if (c.patch) {
    for (const [path, patch] of splitMultiFileDiff(c.patch, "candidate")) {
      if (path === "candidate" && !patch.trim()) continue;
      files.push({ filename: path, patch, additions: 0, deletions: 0, status: "modified" });
    }
  }
  for (const f of c.files ?? []) {
    if (files.some((x) => x.filename === f.path)) continue;
    // Ranges become a synthetic replacement hunk per range (base coordinates are what matter).
    const patch = f.ranges?.length
      ? f.ranges
          .map(([s, e]) => {
            const len = Math.max(1, e - s + 1);
            return [`@@ -${s},${len} +${s},${len} @@`, ...Array.from({ length: len }, () => "-·"), ...Array.from({ length: len }, () => "+·")].join("\n");
          })
          .join("\n")
      : undefined;
    files.push({ filename: f.path, ...(patch ? { patch } : {}), additions: 0, deletions: 0, status: "modified" });
  }
  return {
    number: CANDIDATE,
    title: "Your change",
    author: "preflight",
    createdAt: FUTURE,
    htmlUrl: "",
    files,
    ...(c.baseSha ? { baseSha: c.baseSha } : {}),
  };
}

/**
 * Agent / CI preflight: "will this change collide with any open PR?" Runs the SAME classifiers as
 * the graph (base-coordinate regions, regenerable files, cross-file symbol impact) — but only
 * against PRs that can possibly interact with the candidate, never the whole graph. Pure.
 */
export function preflight(
  openPRs: PRWithFiles[],
  candidate: PreflightCandidate,
  opts: { statusOf?: (prNumber: number) => NodeStatus | undefined; ignoreGlobs?: string[] } = {},
): PreflightResult {
  const cand = candidatePR(candidate);
  const candFiles = new Set(cand.files.flatMap((f) => [f.filename, ...(f.previousFilename ? [f.previousFilename] : [])]));

  // Symbol relevance: names the candidate defines-or-changes and names it references.
  const candFacts = symbolFacts(cand);
  const candDefs = new Set(candFacts.flatMap((f) => [...f.defs.keys()]));
  const candRefs = new Set(candFacts.flatMap((f) => [...f.refs]));

  const relevant = openPRs.filter((p) => {
    if (p.files.some((f) => candFiles.has(f.filename) || (f.previousFilename && candFiles.has(f.previousFilename)))) return true;
    for (const f of symbolFacts(p)) {
      for (const name of f.defs.keys()) if (candRefs.has(name)) return true;
      for (const name of f.refs) if (candDefs.has(name)) return true;
    }
    return false;
  });

  const graph = buildDependencyGraph([...relevant, cand], { ignoreGlobs: opts.ignoreGlobs });
  const byNumber = new Map(relevant.map((p) => [p.number, p]));
  const me = String(CANDIDATE);

  const collisions: PreflightCollision[] = [];
  for (const e of graph.edges) {
    if (e.type === "INDIRECT" || e.type === "STACKED") continue;
    if (e.source !== me && e.target !== me) continue;
    const otherId = Number(e.source === me ? e.target : e.source);
    const other = byNumber.get(otherId);
    if (!other) continue;
    const kind: PreflightKind = e.type === "SEMANTIC" ? "SEMANTIC" : e.blocking ? "BLOCKS" : "TOUCHES";
    collisions.push({
      pr: {
        number: other.number,
        title: other.title,
        url: other.htmlUrl,
        author: other.author,
        status: opts.statusOf?.(other.number) ?? "UNKNOWN",
      },
      kind,
      direction: e.target === me ? "wait" : "affects",
      blocking: e.blocking,
      files: e.sharedFiles,
      regions: (e.conflicts ?? [])
        .filter((c) => c.kind === "overlap")
        .flatMap((c) => c.regions.map((r) => ({ file: c.file, baseStart: r.baseStart, baseEnd: r.baseEnd }))),
      symbols: e.symbols ?? [],
    });
  }

  const rank = (c: PreflightCollision) => (c.blocking ? 0 : 1) * 10 + (c.kind === "BLOCKS" ? 0 : c.kind === "SEMANTIC" ? 1 : 2);
  collisions.sort((a, b) => rank(a) - rank(b) || a.pr.number - b.pr.number);

  const waitFor = collisions.filter((c) => c.blocking && c.direction === "wait").map((c) => c.pr.number);
  const affects = collisions.filter((c) => c.blocking && c.direction === "affects").map((c) => c.pr.number);
  const risk: PreflightResult["risk"] = collisions.some((c) => c.blocking) ? "high" : collisions.length ? "low" : "none";

  const recommendation =
    risk === "none"
      ? "No open PR touches the same code — safe to proceed."
      : risk === "low"
        ? `Shares files with ${collisions.map((c) => `#${c.pr.number}`).join(", ")} but in different lines — expect a clean merge.`
        : [
            waitFor.length ? `Wait for ${waitFor.map((n) => `#${n}`).join(", ")} to merge, then rebase.` : "",
            affects.length
              ? `Your change breaks code that ${affects.map((n) => `#${n}`).join(", ")} relies on — coordinate with ${affects.length === 1 ? "its author" : "their authors"}.`
              : "",
          ]
            .filter(Boolean)
            .join(" ");

  return { risk, collisions, waitFor, recommendation };
}
