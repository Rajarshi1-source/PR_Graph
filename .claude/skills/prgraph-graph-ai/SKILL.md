---
name: prgraph-graph-ai
description: >-
  Build and maintain PRGraph's core differentiator: the dependency-graph engine and the AI semantic
  conflict analysis with its MLOps wrapper. Use for ANY work on the graph algorithms (file-overlap
  inverted index, edge classification, Kahn topological sort for merge order, DFS cycle detection,
  graph diffing) or the AI layer (provider-agnostic LLM adapter, versioned prompt registry,
  content-addressed Redis cache, Zod-validated output, heuristic fallback, the eval harness that gates
  CI on precision/recall/F1, cost telemetry, budget breaker). Trigger on dependency graph, topological
  sort, Kahn, cycle detection, DAG, merge order, semantic conflict, LLM adapter, prompt registry, eval
  harness, F1, GPT-5.4, or MLOps. MANDATE: the graph core is pure deterministic TypeScript with full
  unit-test coverage; the LLM is a refinement stage with a heuristic fallback so the product never
  breaks; never hardcode a model — go through the adapter and justify the default with the eval set.
  Pair with prgraph-nextjs-backend for wiring.
---

# Graph Engine + AI Semantic Conflict Analysis — PRGraph Core

You build the two pieces that make **PRGraph** memorable: (1) the **deterministic dependency-graph
engine** (the algorithmic spine), and (2) the **AI semantic conflict analyzer** plus its **MLOps
wrapper** (the Phase-2 differentiator that lifts the project from "good full-stack" to "shipped an
AI feature with an eval gate"). This is also the part that makes PRGraph credible to AI-Engineer
panels, not just full-stack ones.

## The two layers (and the rule that connects them)

```
Layer 1 — deterministic engine (always on, pure, fully tested)
  PRs+files → inverted index → candidate edges (file overlap) → classify → topo sort → cycle detect
        │
        ▼  (only the edges already flagged as overlapping)
Layer 2 — AI refinement (optional, Phase 2)
  for each candidate edge: LLM reads the two diff hunks → TRUE_CONFLICT | CO_LOCATED | UNCERTAIN
  CO_LOCATED edges stop blocking → topo sort re-runs → more PRs become SAFE
```

**The single most important rule:** the AI is a *refinement on edges the deterministic engine already
produced* — never a replacement. This bounds cost (you analyze a handful of pairs, not N²) and
guarantees a working product when the LLM is off, over budget, or down. **AI failure degrades to
deterministic behaviour, never to broken.**

## Critical rules (never violate)

- **The graph core is pure and deterministic.** No I/O, no Date.now, no randomness inside
  `buildDependencyGraph`/`topologicalSort`/`detectCycles` — pass data in, get a result out. This is
  what makes it 100%-unit-testable and trivial to reason about.
- **Compute in memory, not in SQL.** The graph is under ~500 nodes; build it in TypeScript and
  persist the result. Do not implement topo sort / cycle detection as recursive SQL CTEs.
- **Never trust raw LLM output.** Parse it through a **Zod schema**; on parse failure, fall back to
  the heuristic verdict — never surface a malformed model response.
- **Content-address the AI cache.** Key on `sha256(promptVersion + diffA + diffB)`. Identical pairs
  never cost twice; this is the dominant cost lever.
- **Prompts are versioned files**, and the version is part of the cache key and the eval. A prompt
  change is a code change.
- **The eval gates CI.** A prompt/model change that regresses precision/recall/F1 below threshold
  fails the build, exactly like a broken unit test.
- **Never hardcode a model.** Everything goes through `LLMAdapter`; the default is chosen on eval
  evidence and swappable by config.

## Layer 1 — the deterministic engine

```typescript
// lib/graph/buildDependencyGraph.ts  (pure)
export function buildDependencyGraph(prs: PRWithFiles[]): DependencyGraph {
  // 1. inverted index: file -> PRs that touch it
  const byFile = new Map<string, PRWithFiles[]>();
  for (const pr of prs) for (const f of pr.files)
    (byFile.get(f.filename) ?? byFile.set(f.filename, []).get(f.filename)!).push(pr);

  // 2. pairwise overlaps -> edges (earlier PR by created_at blocks the later one)
  const edges = new Map<string, GraphEdge>();
  for (const [filename, touch] of byFile) {
    if (touch.length < 2) continue;
    for (let i = 0; i < touch.length; i++) for (let j = i + 1; j < touch.length; j++) {
      const [a, b] = earlierFirst(touch[i], touch[j]);
      const key = `${a.number}-${b.number}`;
      const e = edges.get(key);
      if (e) e.sharedFiles.push(filename);
      else edges.set(key, { id: key, source: String(a.number), target: String(b.number),
                            type: 'BLOCKS', sharedFiles: [filename] });
    }
  }
  // 3. classify edge severity by overlap count
  for (const e of edges.values())
    e.type = e.sharedFiles.length >= 3 ? 'CRITICAL_BLOCK' : e.sharedFiles.length === 1 ? 'TOUCHES' : 'BLOCKS';

  const edgeList = [...edges.values()];
  const cycles = detectCycles(prs.map(p => String(p.number)), edgeList);
  const inCycle = new Set(cycles.flat());
  const incoming = inDegree(prs, edgeList);

  const nodes: GraphNode[] = prs.map(pr => ({
    id: String(pr.number), type: 'prNode', position: { x: 0, y: 0 },
    data: { /* ...pr fields... */, status: classify(String(pr.number), incoming, inCycle),
            blockedBy: edgeList.filter(e => e.target === String(pr.number)).map(e => e.source),
            blocking:  edgeList.filter(e => e.source === String(pr.number)).map(e => e.target) },
  }));
  return { nodes, edges: edgeList, mergeOrder: topologicalSort(nodes, edgeList), cycles, stats: stats(nodes, edgeList) };
}

function classify(id: string, incoming: Map<string, number>, inCycle: Set<string>): NodeStatus {
  if (inCycle.has(id)) return 'DEADLOCKED';
  return (incoming.get(id) ?? 0) === 0 ? 'SAFE' : 'BLOCKED';
}
```

- **Topological sort = Kahn's algorithm**, emitted as *levels*: level 0 = merge now, level 1 = merge
  after level 0, etc. Remaining-in-degree nodes are in cycles.
- **Cycle detection = DFS 3-colour** (white/grey/black); grey-on-grey is a back edge → cycle →
  `DEADLOCKED`.
- **Graph diff** compares old vs new snapshot and reports status transitions (e.g. `#57 BLOCKED→SAFE`)
  — this is what the backend pushes over Socket.IO and what Slack announces.

The full, runnable engine + Kahn + DFS + a Vitest suite is in the **starter code doc**
(`PRGraph_starter_code.md`, Part 1). Read it before re-implementing any of this.

## Layer 2 — the AI analyzer (provider-agnostic, cached, fallback)

```typescript
// lib/ai/conflictAnalyzer.ts
import { z } from 'zod';
import crypto from 'node:crypto';
import { redis } from '@/lib/cache/redis';
import type { LLMAdapter } from './adapters/types';
import { getPrompt } from './prompts/registry';

export const Verdict = z.object({
  verdict: z.enum(['TRUE_CONFLICT', 'CO_LOCATED', 'UNCERTAIN']),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(400),
});
export type Verdict = z.infer<typeof Verdict>;
const PROMPT_VERSION = 'conflict.v3';

export async function analyzeConflict(a: LLMAdapter, dA: string, dB: string): Promise<Verdict> {
  const key = `ai:conflict:${PROMPT_VERSION}:` +
    crypto.createHash('sha256').update(`${dA}\u0000${dB}`).digest('hex');
  const hit = await redis.get(key);
  if (hit) return Verdict.parse(JSON.parse(hit));

  const raw = await a.completeJSON(getPrompt(PROMPT_VERSION, { dA, dB }));
  const v = Verdict.parse(raw);                       // never trust raw output
  await redis.setex(key, 86_400, JSON.stringify(v));
  return v;
}

export async function analyzeOrFallback(a: LLMAdapter | null, dA: string, dB: string): Promise<Verdict> {
  if (!a || (await budgetExceeded())) return heuristic();         // AI off / over budget
  try { return await analyzeConflict(a, dA, dB); }
  catch { metrics.inc('ai.fallback'); return heuristic(); }       // degrade, never break
}
const heuristic = (): Verdict => ({ verdict: 'TRUE_CONFLICT', confidence: 0.5, explanation: 'file overlap (heuristic)' });
```

The diff hunks come from `octokit.rest.pulls.listFiles` (the `patch` field) — fetched by
prgraph-nextjs-backend and handed in here. Wiring the prompt + adapter + diff-fetcher + harness
end-to-end is documented in `PRGraph_eval_connectors.md`.

## Model choice — current, honest, defensible

- **"GPT-5" the original (Aug 2025) is two generations old.** As of mid-2026 OpenAI's flagship is
  **GPT-5.4** (Mar 2026), which folded in Codex-level coding, and ships as Standard / Thinking / Pro /
  Mini / Nano tiers.
- **Default = GPT-5.4-mini.** Conflict analysis is a short, structured classification over two diffs.
  A mini, coding-capable tier gives strong quality at a fraction of the flagship cost; the frontier
  tiers (Pro/Thinking) are overkill and the long-context surcharge bites on large diffs.
- **Escalate only on `UNCERTAIN`** to a bigger tier; keep a second cloud provider (e.g. Claude) and a
  local model (Ollama) behind the same `LLMAdapter` so you can A/B on the eval set.
- **The real decision is the adapter, not the vendor.** Defend the default with numbers from the eval
  (F1 vs cost), and switching providers is a one-line config change.

## The MLOps wrapper (five components)

| Component | Where | Purpose |
|---|---|---|
| Provider-agnostic `LLMAdapter` | `lib/ai/adapters/*` | one interface, swappable backends; no vendor lock-in |
| Versioned prompt registry | `lib/ai/prompts/*` | prompts are files; version is in the cache key + eval |
| Content-addressed cache | Redis | `sha256(promptVersion+diffA+diffB)` → verdict; huge cost lever |
| Eval harness gating CI | `evals/` + CI job | precision/recall/F1 vs a labeled fixture set; fail on regression |
| Cost/latency telemetry + budget breaker | Prometheus | `llm_tokens_total`, `llm_cost_usd_total`, `llm_latency_ms`, `llm_cache_hit_ratio`; trip to fallback past a daily cap |

```typescript
// lib/ai/adapters/types.ts
export interface LLMAdapter {
  readonly name: string;                                  // 'openai:gpt-5.4-mini', 'anthropic:...', 'ollama:...'
  completeJSON(prompt: Prompt): Promise<unknown>;         // throws on failure (retry/timeout inside)
  estimateCostUsd(inTok: number, outTok: number): number;
}
```

The eval harness (labeled fixtures + precision/recall/F1 + CI gate) is in `PRGraph_starter_code.md`
Part 2; the prompt + adapter + endpoint wiring is in `PRGraph_eval_connectors.md`. Read those before
building the AI layer.

## Anti-patterns to fix on sight

| Anti-pattern | Fix |
|---|---|
| I/O, `Date.now`, or randomness inside the graph core | keep it pure; inject inputs; test exhaustively |
| Topo sort / cycle detection as recursive SQL CTEs | in-memory TypeScript (Kahn + DFS), persist the result |
| Running the LLM on all N² pairs | only on edges the deterministic engine flagged |
| `JSON.parse(rawLLM)` straight into the graph | validate with Zod; fallback to heuristic on failure |
| Caching by PR number / time | content-address on `sha256(promptVersion+diffA+diffB)` |
| Inline prompt strings | versioned files in the prompt registry |
| Hardcoding `openai(...)` in the analyzer | go through `LLMAdapter`; choose default via eval |
| No regression gate on prompt changes | eval harness fails CI on F1 drop |
| LLM outage takes down the graph | heuristic fallback + budget breaker |

## Quick reference

- Two layers: deterministic engine (always on, pure, tested) → AI refinement (optional, fallback).
- Engine: inverted index → edges → classify → Kahn levels → DFS cycles → diff. In memory, not SQL.
- AI: `LLMAdapter` → Zod-validated verdict → content-addressed Redis cache → heuristic fallback.
- Default model GPT-5.4-mini (escalate on UNCERTAIN); never hardcode — justify with the eval set.
- MLOps: adapter + versioned prompts + eval-gates-CI + cost/latency metrics + budget breaker.
- Runnable engine + tests → `PRGraph_starter_code.md` Part 1; eval harness → Part 2; wiring →
  `PRGraph_eval_connectors.md`. Backend wiring (queue, socket, octokit) → prgraph-nextjs-backend.
