import type { DependencyGraph, GraphEdge, GraphNode } from "@/lib/graph/types";

export type CheckConclusion = "success" | "neutral" | "failure";

export interface CheckSummary {
  title: string;
  summary: string;
  conclusion: CheckConclusion;
}

const STATUS_LINE: Record<GraphNode["data"]["status"], string> = {
  SAFE: "✅ Safe to merge — no open PR conflicts with this one.",
  AT_RISK: "🟡 Has non-blocking dependencies — merges cleanly, but shares files with other open PRs.",
  BLOCKED: "⛔ Blocked — merge the PRs below first (or rebase after they land).",
  DEADLOCKED: "🔒 Deadlocked — this PR and others depend on each other; a human needs to pick an order.",
};

function lineRange(baseStart: number, baseEnd: number): string {
  return baseEnd >= baseStart ? (baseEnd > baseStart ? `L${baseStart}–${baseEnd}` : `L${baseStart}`) : `before L${baseStart}`;
}

function describeEdge(e: GraphEdge, other: string, direction: "in" | "out"): string {
  const parts: string[] = [];
  const who = direction === "in" ? `#${other} must merge first` : `#${other} waits on this PR`;
  parts.push(`- **${who}** — ${e.type.toLowerCase()}${e.certainty === "approx" ? " (approximate)" : ""}`);
  for (const c of (e.conflicts ?? []).filter((c) => c.kind === "overlap").slice(0, 5)) {
    const regions = c.regions.slice(0, 3).map((r) => lineRange(r.baseStart, r.baseEnd)).join(", ");
    parts.push(`  - \`${c.file}\`${regions ? ` ${regions}` : ""}`);
  }
  for (const s of (e.symbols ?? []).slice(0, 3)) {
    parts.push(`  - \`${s.name}\` ${s.change} in \`${s.defFile}\`, used in \`${s.refFile}\``);
  }
  if (e.explanation && e.verdictOrigin !== "heuristic") parts.push(`  - AI: ${e.explanation}`);
  if (e.resolution) parts.push(`  - Suggested: ${e.resolution}`);
  return parts.join("\n");
}

/**
 * Markdown for the `PRGraph` Check Run on one PR. Pure and deterministic (no timestamps), so its
 * hash only changes when the content does — the publisher skips unchanged writes.
 */
export function renderCheckSummary(
  node: GraphNode,
  graph: DependencyGraph,
  opts: { failOnConflict: boolean; appUrl: string; fullName: string },
): CheckSummary {
  const id = node.id;
  const incoming = graph.edges.filter((e) => e.target === id && e.blocking && e.type !== "INDIRECT");
  const outgoing = graph.edges.filter((e) => e.source === id && e.blocking && e.type !== "INDIRECT");
  const soft = graph.edges.filter((e) => e.target === id && !e.blocking && e.type !== "INDIRECT");
  const status = node.data.status;

  const lines: string[] = [STATUS_LINE[status], ""];
  if (incoming.length) {
    lines.push("#### Blocked by");
    incoming.forEach((e) => lines.push(describeEdge(e, e.source, "in")));
    lines.push("");
  }
  if (outgoing.length) {
    lines.push("#### Blocking");
    outgoing.forEach((e) => lines.push(describeEdge(e, e.target, "out")));
    lines.push("");
  }
  if (soft.length) {
    lines.push(`#### Shares files with (non-blocking)`);
    lines.push(soft.map((e) => `#${e.source}`).join(", "));
    lines.push("");
  }

  const step = node.data.planStep;
  const parked = graph.mergePlan?.parked.find((p) => p.id === id);
  if (step) lines.push(`**Merge plan:** step ${step} of ${graph.mergePlan?.totalSteps ?? step}.`);
  else if (parked) lines.push(`**Merge plan:** parked — ${parked.reasons.join("; ")}.`);

  const [owner, name] = opts.fullName.split("/");
  lines.push("", `[Open the dependency graph](${opts.appUrl}/repo/${owner}/${name})`);

  const conclusion: CheckConclusion =
    status === "SAFE"
      ? "success"
      : opts.failOnConflict && (status === "BLOCKED" || status === "DEADLOCKED")
        ? "failure"
        : "neutral";

  const title =
    status === "SAFE"
      ? "No conflicts with open PRs"
      : status === "AT_RISK"
        ? `Shares files with ${soft.length} open PR${soft.length === 1 ? "" : "s"}`
        : status === "DEADLOCKED"
          ? "Deadlocked with other open PRs"
          : `Blocked by ${incoming.map((e) => `#${e.source}`).join(", ")}`;

  return { title, summary: lines.join("\n").slice(0, 60_000), conclusion };
}
