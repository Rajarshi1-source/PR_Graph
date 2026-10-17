import type { DependencyGraph, GraphNode, MergePlan, MergePlanStep, ParkedPR, Readiness } from "./types";
import { compareIds } from "./indirect";

/**
 * Conflict-aware merge plan (Feature C). Pure.
 *
 * Simulates merging in steps. A PR is mergeable in a step when every blocking predecessor has been
 * merged in an earlier step AND it is READY. All such PRs form one batch — they are mutually
 * independent by construction (a blocking edge between two of them would mean one still waits on
 * the other). PRs that are not READY are parked with reasons; PRs stuck behind parked or
 * deadlocked PRs are parked with `waitingOn`. The critical path is the longest blocking chain.
 *
 * Without readiness data every PR is treated as READY (pure topology).
 */
export function planMerges(graph: DependencyGraph, readiness?: Map<string, Readiness>): MergePlan {
  const ids = graph.nodes.map((n) => n.id);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const blocking = graph.edges.filter((e) => e.blocking && e.type !== "INDIRECT");
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of blocking) {
    preds.get(e.target)?.push(e.source);
    succs.get(e.source)?.push(e.target);
  }
  const inCycle = new Set(graph.cycles.flat());
  const readinessOf = (id: string) => readiness?.get(id) ?? byId.get(id)?.data.readiness;
  const isReady = (id: string) => {
    const r = readinessOf(id);
    return !r || r.state === "READY";
  };

  // transitive dependents → priority (merging a PR that unblocks more work first)
  const dependents = new Map<string, number>();
  for (const id of ids) {
    const seen = new Set<string>();
    const stack = [...(succs.get(id) ?? [])];
    while (stack.length) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      stack.push(...(succs.get(v) ?? []));
    }
    seen.delete(id);
    dependents.set(id, seen.size);
  }
  const created = (id: string) => byId.get(id)?.data.createdAt ?? "";
  const priority = (a: string, b: string) =>
    dependents.get(b)! - dependents.get(a)! ||
    (readinessOf(b)?.score ?? 100) - (readinessOf(a)?.score ?? 100) ||
    created(a).localeCompare(created(b)) ||
    compareIds(a, b);

  const merged = new Set<string>();
  const steps: MergePlanStep[] = [];
  const unblockedNow = (id: string) => (preds.get(id) ?? []).every((p) => merged.has(p));

  for (;;) {
    const batch = ids
      .filter((id) => !merged.has(id) && !inCycle.has(id) && unblockedNow(id) && isReady(id))
      .sort(priority);
    if (batch.length === 0) break;
    const before = new Set(ids.filter((id) => !merged.has(id) && unblockedNow(id)));
    batch.forEach((id) => merged.add(id));
    const unlocks = ids
      .filter((id) => !merged.has(id) && !before.has(id) && unblockedNow(id))
      .sort(compareIds);
    steps.push({ index: steps.length + 1, prs: batch, unlocks, rationale: rationaleFor(batch, unlocks, readinessOf) });
  }

  // Everything left over is parked: not ready, deadlocked, or waiting on one of those.
  const parked: ParkedPR[] = [];
  const left = ids.filter((id) => !merged.has(id));
  const leftSet = new Set(left);
  for (const id of left.sort(compareIds)) {
    const reasons: string[] = [];
    if (inCycle.has(id)) {
      const cycle = graph.cycles.find((c) => c.includes(id)) ?? [];
      reasons.push(`Deadlocked with ${cycle.filter((x) => x !== id).map((x) => `#${x}`).join(", ")} — needs a human decision`);
    }
    const r = readinessOf(id);
    if (r && r.state !== "READY") reasons.push(...r.reasons);
    const waitingOn = upstreamParked(id, preds, leftSet);
    if (waitingOn.length) {
      reasons.push(`Waiting on ${waitingOn.map((w) => `#${w}`).join(", ")}`);
    }
    parked.push({ id, reasons: reasons.length ? reasons : ["Waiting on earlier merges"], waitingOn });
  }

  return { steps, parked, criticalPath: criticalPath(graph, preds, inCycle), totalSteps: steps.length };
}

/** Parked ancestors (over blocking edges) that hold this PR back. */
function upstreamParked(id: string, preds: Map<string, string[]>, left: Set<string>): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [...(preds.get(id) ?? [])];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p) || p === id) continue;
    seen.add(p);
    if (left.has(p)) out.add(p);
    stack.push(...(preds.get(p) ?? []));
  }
  return [...out].sort(compareIds);
}

/** Longest chain of blocking edges (DP over the Kahn order; cycle members excluded). */
function criticalPath(graph: DependencyGraph, preds: Map<string, string[]>, inCycle: Set<string>): string[] {
  const order = graph.mergeOrder.levels.flat().filter((id) => !inCycle.has(id));
  const best = new Map<string, { len: number; prev?: string }>();
  for (const id of order) {
    let cur: { len: number; prev?: string } = { len: 1 };
    for (const p of [...(preds.get(id) ?? [])].sort(compareIds)) {
      const b = best.get(p);
      if (b && b.len + 1 > cur.len) cur = { len: b.len + 1, prev: p };
    }
    best.set(id, cur);
  }
  let end: string | undefined;
  for (const id of order) if (!end || best.get(id)!.len > best.get(end)!.len) end = id;
  if (!end || best.get(end)!.len < 2) return [];
  const path: string[] = [];
  for (let c: string | undefined = end; c; c = best.get(c)?.prev) path.unshift(c);
  return path;
}

function rationaleFor(batch: string[], unlocks: string[], readinessOf: (id: string) => Readiness | undefined): string {
  const list = batch.map((id) => `#${id}`).join(", ");
  const green = batch.every((id) => {
    const r = readinessOf(id);
    return r && r.ci === "success";
  });
  const what =
    batch.length === 1
      ? `Merge ${list}${green ? " (CI green)" : ""}`
      : `Merge ${list} together — independent of each other${green ? " and all green" : ""}`;
  return unlocks.length ? `${what}. Unblocks ${unlocks.map((u) => `#${u}`).join(", ")}.` : `${what}.`;
}

/** Attach readiness + plan to the graph (nodes get `readiness` and `planStep`). Pure. */
export function withMergePlan(graph: DependencyGraph, readiness?: Map<string, Readiness>): DependencyGraph {
  const nodes: GraphNode[] = graph.nodes.map((n) => {
    const r = readiness?.get(n.id) ?? n.data.readiness;
    return { ...n, data: { ...n.data, ...(r ? { readiness: r } : {}) } };
  });
  const base: DependencyGraph = { ...graph, nodes };
  const plan = planMerges(base, readiness);
  const stepOf = new Map<string, number>();
  for (const s of plan.steps) for (const id of s.prs) stepOf.set(id, s.index);
  return {
    ...base,
    nodes: nodes.map((n) => ({ ...n, data: { ...n.data, planStep: stepOf.get(n.id) ?? null } })),
    mergePlan: plan,
  };
}

/** Markdown rendering of a plan (copy button, Slack, Check Run summary). Pure. */
export function planToMarkdown(plan: MergePlan, graph: DependencyGraph, repo?: string): string {
  const title = (id: string) => graph.nodes.find((n) => n.id === id)?.data.title ?? "";
  const out: string[] = [`### Merge plan${repo ? ` — ${repo}` : ""}`, ""];
  if (plan.steps.length === 0) out.push("_Nothing is ready to merge yet._");
  for (const s of plan.steps) {
    out.push(`${s.index}. ${s.prs.map((id) => `#${id} ${title(id)}`.trim()).join(" · ")}`);
    out.push(`   - ${s.rationale}`);
  }
  if (plan.parked.length) {
    out.push("", "**Parked**");
    for (const p of plan.parked) out.push(`- #${p.id} ${title(p.id)} — ${p.reasons.join("; ")}`);
  }
  if (plan.criticalPath.length) out.push("", `Critical path: ${plan.criticalPath.map((id) => `#${id}`).join(" → ")}`);
  return out.join("\n");
}
