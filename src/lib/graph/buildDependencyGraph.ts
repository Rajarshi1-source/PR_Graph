import type {
  PRWithFiles,
  PRFile,
  DependencyGraph,
  GraphEdge,
  GraphNode,
  EdgeSeverity,
  FileConflict,
  EngineOptions,
  SymbolLink,
} from "./types";
import { parsePatch, type ParsedPatch } from "./patch/parsePatch";
import { conflictingRegions, nearestRegions } from "./patch/regions";
import { isRegenerable } from "./ignore";
import { stackLinks } from "./stacks";
import { impactLinks } from "./symbols/impact";
import { workspacesOf } from "./workspaces";
import { deriveGraph } from "./derive";

/**
 * Build a dependency graph from open PRs and their patches.
 *
 * PURE & DETERMINISTIC: data in → graph out. No I/O, no clock, no randomness, explicit tie-breaks,
 * so the same input always yields the identical graph (testable + cacheable).
 *
 *   1. inverted index: filename → PRs touching it (renames indexed under both names)
 *   2. per shared file, compare BASE-coordinate change regions:
 *        overlap/adjacent → BLOCKS · disjoint → TOUCHES · no patch → BLOCKS (approx)
 *        regenerable files (lockfiles, snapshots, build output) never block
 *   3. hard links: STACKED (base ref = other head ref), SEMANTIC (cross-file symbol impact)
 *   4. orient file edges along a topological order of the hard links (creation time breaks ties),
 *      so convention-only file edges can never fabricate a deadlock
 *   5. merge all signals into one edge per pair, then derive status / cycles / Kahn / INDIRECT
 */
export function buildDependencyGraph(prs: PRWithFiles[], opts: EngineOptions = {}): DependencyGraph {
  const ordered = [...prs].sort(byCreation);
  const order = new Map(ordered.map((p, i) => [p.number, i]));
  const byNumber = new Map(ordered.map((p) => [p.number, p]));

  // 1. inverted index (+ parsed patches, parsed once)
  const parsed = new Map<string, ParsedPatch>();
  const parse = (pr: number, f: PRFile) => {
    const key = `${pr}\u0000${f.filename}`;
    let p = parsed.get(key);
    if (!p) parsed.set(key, (p = parsePatch(f.patch)));
    return p;
  };
  const byFile = new Map<string, { pr: number; file: PRFile }[]>();
  const index = (name: string, pr: number, file: PRFile) => {
    const arr = byFile.get(name);
    if (!arr) byFile.set(name, [{ pr, file }]);
    else if (!arr.some((x) => x.pr === pr)) arr.push({ pr, file });
  };
  for (const pr of ordered) {
    for (const f of pr.files) {
      index(f.filename, pr.number, f);
      if (f.previousFilename) index(f.previousFilename, pr.number, f);
    }
  }

  // 2. per-file classification, accumulated per unordered pair (lo = earlier PR)
  const pairs = new Map<string, PairSignal>();
  for (const name of [...byFile.keys()].sort()) {
    const touch = byFile.get(name)!;
    if (touch.length < 2) continue;
    for (let i = 0; i < touch.length; i++) {
      for (let j = i + 1; j < touch.length; j++) {
        const [x, y] = order.get(touch[i].pr)! <= order.get(touch[j].pr)! ? [touch[i], touch[j]] : [touch[j], touch[i]];
        const key = `${x.pr}|${y.pr}`;
        const sig = pairs.get(key) ?? { lo: x.pr, hi: y.pr, files: [] };
        sig.files.push(classifyFile(name, x, y, parse, opts.ignoreGlobs ?? []));
        pairs.set(key, sig);
      }
    }
  }

  // 3. hard links
  const stacks = stackLinks(ordered);
  const impacts = impactLinks(ordered);

  // 4. rank = topological order of hard links (ties → creation order)
  const rank = hardRank(
    ordered.map((p) => p.number),
    [...stacks, ...impacts.map((l) => [l.source, l.target] as [number, number])],
    order,
  );

  // 5. assemble edges
  const edges = new Map<string, GraphEdge>();
  const put = (e: GraphEdge) => edges.set(e.id, e);
  for (const [parent, child] of stacks) {
    put({
      id: `${parent}-${child}`,
      source: String(parent),
      target: String(child),
      type: "STACKED",
      sharedFiles: [],
      blocking: true,
      severity: "high",
      evidence: "stack",
      certainty: "exact",
    });
  }
  for (const link of impacts) {
    const id = `${link.source}-${link.target}`;
    const existing = edges.get(id);
    if (existing) existing.symbols = mergeSymbols(existing.symbols, link.symbols);
    else
      put({
        id,
        source: String(link.source),
        target: String(link.target),
        type: "SEMANTIC",
        sharedFiles: [],
        blocking: true,
        severity: "high",
        evidence: "symbol",
        certainty: "approx",
        symbols: link.symbols,
      });
  }

  for (const sig of pairs.values()) {
    const a = byNumber.get(sig.lo)!;
    const b = byNumber.get(sig.hi)!;
    const drift = Boolean(a.baseSha && b.baseSha && a.baseSha !== b.baseSha);
    const forward = edges.get(`${sig.lo}-${sig.hi}`);
    const backward = edges.get(`${sig.hi}-${sig.lo}`);
    // Direction: an existing hard edge wins; otherwise the lower hard-rank PR is the source.
    const flip = forward ? false : backward ? true : rank.get(sig.hi)! < rank.get(sig.lo)!;
    const files = sig.files.map((f) => (flip ? swapSides(f) : f));
    const source = flip ? sig.hi : sig.lo;
    const target = flip ? sig.lo : sig.hi;
    const fileEdge = fileEdgeFrom(source, target, files, drift);
    const host = forward ?? backward;
    if (host) mergeFileSignal(host, fileEdge);
    else put(fileEdge);
  }

  // 6. nodes (status etc. are derived)
  const nodes: GraphNode[] = ordered.map((pr) => ({
    id: String(pr.number),
    type: "prNode",
    position: { x: 0, y: 0 }, // dagre sets this on the client
    data: {
      prNumber: pr.number,
      title: pr.title,
      author: pr.author,
      authorAvatar: pr.authorAvatar,
      createdAt: pr.createdAt,
      htmlUrl: pr.htmlUrl,
      filesChanged: pr.files.length,
      additions: pr.files.reduce((s, f) => s + f.additions, 0),
      deletions: pr.files.reduce((s, f) => s + f.deletions, 0),
      status: "SAFE",
      blockedBy: [],
      blocking: [],
      headSha: pr.headSha,
      headRef: pr.headRef,
      baseRef: pr.baseRef,
      draft: pr.draft,
      workspaces: workspacesOf(
        pr.files.map((f) => f.filename),
        opts.workspaceGlobs?.length ? opts.workspaceGlobs : undefined,
      ),
    },
  }));

  return deriveGraph(nodes, [...edges.values()]);
}

interface PairSignal {
  lo: number;
  hi: number;
  files: FileConflict[];
}

function classifyFile(
  name: string,
  x: { pr: number; file: PRFile },
  y: { pr: number; file: PRFile },
  parse: (pr: number, f: PRFile) => ParsedPatch,
  ignoreGlobs: string[],
): FileConflict {
  if (isRegenerable(name, ignoreGlobs)) return { file: name, kind: "regenerable", method: "none", regions: [] };

  const sx = x.file.status;
  const sy = y.file.status;
  if (sx === "removed" || sy === "removed") {
    // delete/delete merges cleanly; modify/delete is a conflict git cannot resolve.
    const kind = sx === "removed" && sy === "removed" ? "disjoint" : "overlap";
    return { file: name, kind, method: "patch", regions: [] };
  }
  if (x.file.previousFilename || y.file.previousFilename) {
    // rename vs edit: git usually follows renames, but line numbers are not comparable.
    if (x.file.filename !== y.file.filename) return { file: name, kind: "unknown", method: "none", regions: [] };
  }

  const px = parse(x.pr, x.file);
  const py = parse(y.pr, y.file);
  if (!px.parseable || !py.parseable) return { file: name, kind: "unknown", method: "none", regions: [] };
  if (sx === "added" && sy === "added") {
    // add/add: clean only if both add the identical file.
    const same = x.file.patch === y.file.patch;
    return { file: name, kind: same ? "disjoint" : "overlap", method: "patch", regions: same ? [] : conflictingRegions(px.regions, py.regions) };
  }

  const regions = conflictingRegions(px.regions, py.regions);
  if (regions.length) return { file: name, kind: "overlap", method: "patch", regions };
  return { file: name, kind: "disjoint", method: "patch", regions: nearestRegions(px.regions, py.regions) };
}

function swapSides(f: FileConflict): FileConflict {
  return { ...f, regions: f.regions.map((r) => ({ ...r, aPreview: r.bPreview, bPreview: r.aPreview })) };
}

function fileEdgeFrom(source: number, target: number, files: FileConflict[], drift: boolean): GraphEdge {
  const overlap = files.filter((f) => f.kind === "overlap").length;
  const unknown = files.filter((f) => f.kind === "unknown").length;
  const blocking = overlap + unknown > 0;
  const severity: EdgeSeverity = !blocking
    ? "low"
    : overlap >= 3
      ? "critical"
      : overlap === 2
        ? "high"
        : "medium";
  return {
    id: `${source}-${target}`,
    source: String(source),
    target: String(target),
    type: blocking ? "BLOCKS" : "TOUCHES",
    sharedFiles: files.map((f) => f.file),
    blocking,
    severity,
    evidence: overlap > 0 || !blocking ? "patch" : "unknown",
    certainty: unknown > 0 || drift ? "approx" : "exact",
    conflicts: files,
  };
}

/** Fold a file-overlap signal into an existing STACKED / SEMANTIC edge for the same pair. */
function mergeFileSignal(host: GraphEdge, file: GraphEdge) {
  host.sharedFiles = [...new Set([...host.sharedFiles, ...file.sharedFiles])].sort();
  host.conflicts = [...(host.conflicts ?? []), ...(file.conflicts ?? [])];
  if (host.type === "SEMANTIC" && file.blocking) {
    // A textual conflict outranks the regex-based symbol signal (and may make it exact).
    host.type = "BLOCKS";
    host.evidence = file.evidence;
    host.certainty = file.certainty;
    host.severity = rankSeverity(host.severity, file.severity);
  }
}

const SEVERITY_ORDER: EdgeSeverity[] = ["low", "medium", "high", "critical"];
const rankSeverity = (a: EdgeSeverity, b: EdgeSeverity): EdgeSeverity =>
  SEVERITY_ORDER[Math.max(SEVERITY_ORDER.indexOf(a), SEVERITY_ORDER.indexOf(b))];

function mergeSymbols(a: SymbolLink[] | undefined, b: SymbolLink[]): SymbolLink[] {
  const out = [...(a ?? [])];
  for (const s of b)
    if (!out.some((o) => o.name === s.name && o.refFile === s.refFile)) out.push(s);
  return out;
}

/** Kahn over hard links with creation order as the priority; cycle members appended by creation. */
function hardRank(ids: number[], links: [number, number][], order: Map<number, number>): Map<number, number> {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map<number, number[]>(ids.map((id) => [id, []]));
  for (const [s, t] of links) {
    if (!adj.has(s) || !indeg.has(t)) continue;
    adj.get(s)!.push(t);
    indeg.set(t, indeg.get(t)! + 1);
  }
  const byOrder = (a: number, b: number) => order.get(a)! - order.get(b)!;
  const ready = ids.filter((id) => indeg.get(id) === 0).sort(byOrder);
  const rank = new Map<number, number>();
  while (ready.length) {
    const u = ready.shift()!;
    rank.set(u, rank.size);
    for (const v of adj.get(u)!) {
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) {
        ready.push(v);
        ready.sort(byOrder);
      }
    }
  }
  for (const id of [...ids].sort(byOrder)) if (!rank.has(id)) rank.set(id, rank.size);
  return rank;
}

/** Earlier-created PR first (tie → lower number); unparseable dates sort last. */
function byCreation(a: PRWithFiles, b: PRWithFiles): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  const na = Number.isNaN(ta) ? Infinity : ta;
  const nb = Number.isNaN(tb) ? Infinity : tb;
  if (na !== nb) return na < nb ? -1 : 1;
  return a.number - b.number;
}
