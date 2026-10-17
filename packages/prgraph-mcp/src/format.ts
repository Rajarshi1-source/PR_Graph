import type { GraphPayload, PreflightResponse } from "./client";

const lines = (s: number, e: number) => (e >= s ? (e > s ? `L${s}-${e}` : `L${s}`) : `before L${s}`);

/** Human / agent-readable preflight report. Pure. */
export function formatPreflight(r: PreflightResponse, repo: string): string {
  const head =
    r.risk === "none"
      ? `PRGraph preflight for ${repo}: no collisions — safe to proceed.`
      : `PRGraph preflight for ${repo}: ${r.risk.toUpperCase()} risk — ${r.collisions.length} open PR(s) interact with this change.`;
  const out = [head];
  for (const c of r.collisions) {
    const what =
      c.kind === "SEMANTIC"
        ? c.direction === "wait"
          ? "changes a symbol your change uses"
          : "uses a symbol your change breaks"
        : c.kind === "BLOCKS"
          ? "edits the same lines"
          : "edits the same file (different lines)";
    out.push(`- #${c.pr.number} "${c.pr.title}" by @${c.pr.author} [${c.pr.status}] ${what}${c.blocking ? " (blocking)" : ""}`);
    for (const reg of c.regions.slice(0, 5)) out.push(`    ${reg.file} ${lines(reg.baseStart, reg.baseEnd)}`);
    for (const s of c.symbols.slice(0, 5)) out.push(`    \`${s.name}\` ${s.change} in ${s.defFile}, used in ${s.refFile}`);
    out.push(`    ${c.pr.url}`);
  }
  out.push("", r.recommendation);
  return out.join("\n");
}

/** Conflicts touching one PR (both directions). Pure. */
export function formatPrConflicts(graph: GraphPayload, prNumber: number): string {
  const id = String(prNumber);
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return `PR #${prNumber} is not an open PR in this graph.`;
  const rel = graph.edges.filter((e) => (e.source === id || e.target === id) && e.type !== "INDIRECT");
  const out = [`#${prNumber} "${node.data.title}" — ${node.data.status}`];
  if (rel.length === 0) out.push("No dependencies on other open PRs.");
  for (const e of rel) {
    const other = e.source === id ? e.target : e.source;
    const dir = e.target === id ? `blocked by #${other}` : `blocks #${other}`;
    out.push(`- ${e.blocking ? dir : `shares files with #${other}`} (${e.type.toLowerCase()})`);
    for (const c of (e.conflicts ?? []).filter((c) => c.kind === "overlap").slice(0, 5)) {
      out.push(`    ${c.file} ${c.regions.slice(0, 3).map((r) => lines(r.baseStart, r.baseEnd)).join(", ")}`);
    }
    for (const s of (e.symbols ?? []).slice(0, 3)) out.push(`    \`${s.name}\` ${s.change} (${s.defFile} → ${s.refFile})`);
    if (e.explanation) out.push(`    ${e.explanation}`);
    if (e.resolution) out.push(`    Suggested: ${e.resolution}`);
  }
  return out.join("\n");
}

/** Every PR that is currently held back. Pure. */
export function formatBlocked(graph: GraphPayload): string {
  const held = graph.nodes.filter((n) => n.data.status === "BLOCKED" || n.data.status === "DEADLOCKED");
  if (held.length === 0) return "No open PR is blocked right now.";
  return held
    .map((n) => `#${n.data.prNumber} "${n.data.title}" — ${n.data.status}${n.data.blockedBy.length ? ` (waits on ${n.data.blockedBy.map((b) => `#${b}`).join(", ")})` : ""}`)
    .join("\n");
}
