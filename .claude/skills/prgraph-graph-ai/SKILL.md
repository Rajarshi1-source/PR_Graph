---
name: prgraph-graph-ai
description: >-
  Build and maintain PRGraph's core differentiators: the deterministic dependency-graph engine
  (line-level merge simulation, cross-file symbol impact, stacked-PR edges, transitive edges), the AI
  semantic-conflict layer with its MLOps wrapper, and the planning layer (readiness-aware merge plan,
  what-if simulation, agent preflight). Use for ANY work on the graph algorithms (inverted index,
  unified-diff parsing, base-coordinate change regions, diff3 sequential merge, symbol extraction,
  edge classification BLOCKS/TOUCHES/SEMANTIC/STACKED/INDIRECT, Kahn topological sort, DFS cycle
  detection, graph diff/normalize), the AI layer (provider-agnostic LLM adapter, versioned prompt
  registry, content-addressed cache, Zod-validated output, heuristic fallback, eval harnesses that gate
  CI on precision/recall/F1, cost telemetry, budget breaker), or planning (merge plan batches, critical
  path, readiness score, whatIfMerge, preflight, workspaces, Mermaid export). Trigger on dependency
  graph, merge simulation, conflict regions, diff3, patch parsing, symbol impact, semantic edge,
  stacked PR, topological sort, Kahn, cycle detection, DAG, merge order, merge plan, critical path,
  what-if, preflight, readiness, semantic conflict, LLM adapter, prompt registry, eval harness, F1, or
  MLOps. MANDATE: every engine/planning module is pure deterministic TypeScript with full unit-test
  coverage; exact textual conflicts are facts; the LLM only refines approximate evidence and always
  has a heuristic fallback; never hardcode a model. Pair with prgraph-nextjs-backend for wiring.
---

# Graph Engine + AI + Planning — PRGraph Core

PRGraph answers one question better than any merge queue or AI reviewer on the market (Oct 2026):
**"Which open PRs will collide with each other, why, and in what order should we merge them?"**
Merge queues (Graphite, Mergify, Aviator, Trunk, GitHub merge queue) only discover conflicts once a
PR is *in* the queue, by rebasing and burning CI. AI reviewers (CodeRabbit, Greptile, Diamond) look at
one PR at a time. GitHub only reports PR-vs-base conflicts. PRGraph predicts **PR-vs-PR** conflicts —
textual *and* cross-file semantic — before anyone merges, and exposes that to humans (graph UI), to
GitHub (Check Run), and to AI coding agents (preflight API + MCP server).

## The three layers (and the rules that connect them)

```
Layer 1 — deterministic engine (always on, pure, fully tested)
  PRs+patches → inverted index → per-file change regions (base coordinates)
             → BLOCKS (regions overlap/adjacent) | TOUCHES (disjoint) | approx BLOCKS (no patch / base drift)
             + SEMANTIC (symbol A changes ∩ refs B adds, cross-file)  + STACKED (base ref = other head ref)
             → status (SAFE / AT_RISK / BLOCKED / DEADLOCKED) → Kahn levels → DFS cycles → INDIRECT
        │   Tier-2 deep verify (backend fetches blobs): diff3 sequential merge upgrades approx → exact
        ▼
Layer 2 — AI refinement (optional, AI_ENABLED, cached, budgeted, heuristic fallback)
  approx edges   → LLM may DEMOTE to CO_LOCATED (non-blocking)
  exact BLOCKS   → LLM ANNOTATES (explanation + suggested resolution), never demotes a textual fact
  clean TOUCHES  → LLM may flag a logical risk (semanticVerdict TRUE_CONFLICT) → AT_RISK, never blocking
        ▼
Layer 3 — planning (pure)
  readiness (CI, reviews, mergeable, draft, branch rules) + blocking DAG
  → planMerges: parallel batches of mutually independent ready PRs + parked list + critical path
  → whatIfMerge(prIds) → status transitions;  preflight(candidate patch) → collisions
```

**Most important rules:**

1. **Every module in `src/lib/graph/**` is pure and deterministic** — no I/O, no `Date.now`, no
   randomness, stable sort orders (tie-break on PR number / file path). Same input ⇒ byte-identical
   output. The backend fetches; the engine computes.
2. **Exact textual conflicts are facts.** If base-coordinate change regions overlap (or diff3 reports a
   conflict), git *will* conflict. AI may explain them, never demote them.
3. **The AI only softens approximate evidence** (`certainty: "approx"`): missing patch, base-SHA drift
   without a deep verify, or SEMANTIC (regex-based) edges. AI failure degrades to deterministic
   behaviour, never to broken.
4. **AI can never add a blocking edge.** A logical-risk flag on a clean TOUCHES edge is surfaced as
   `AT_RISK` (yellow) with an explanation, never `BLOCKED`.

## Edge & status taxonomy (shared DTO: `src/lib/graph/types.ts`)

| EdgeType | Meaning | `blocking` | `evidence` / `certainty` |
|---|---|---|---|
| `BLOCKS` | changed base regions overlap or are adjacent in ≥1 shared file (git would conflict) | ✅ | `patch`/`diff3` · exact — or `unknown` · approx when a patch is missing / base SHAs differ |
| `TOUCHES` | same file(s), disjoint regions — merges cleanly | ❌ | `patch` · exact |
| `SEMANTIC` | A removes/renames/changes the signature of a symbol that B newly references in another file | ✅ | `symbol` · approx |
| `STACKED` | B's base branch is A's head branch (stacked PRs) | ✅ | `stack` · exact |
| `INDIRECT` | transitive dependency A ⇝ C over blocking edges with no direct edge (capped at 200) | ❌ | `transitive` |
| `CO_LOCATED` | AI-demoted approx edge — confirmed independent | ❌ | AI verdict |

- `severity: "low" | "medium" | "high" | "critical"` — BLOCKS with ≥3 conflicting files is
  `critical` (this replaces the legacy `CRITICAL_BLOCK` type; `normalizeGraph` upgrades v1 snapshots).
- Regenerable files (lockfiles, `*.snap`, `dist/**`, plus per-repo `ignoreGlobs`) never produce
  BLOCKS — overlap there is downgraded to TOUCHES with severity `low` (they are regenerated on rebase).
- **Edge direction:** STACKED = parent → child; SEMANTIC = definer → user; file edges = earlier PR
  (createdAt, tie-break number) → later PR. Because SEMANTIC/STACKED ignore creation order, real
  cycles exist → `DEADLOCKED` is meaningful.
- One edge per ordered pair; when several signals hit the same pair they **merge** (blocking if any
  signal blocks; conflicts/symbols concatenated; worst severity wins). If two signals point in
  opposite directions, keep both edges (that is a genuine deadlock).

| NodeStatus | Rule (computed over **blocking** edges only) | Colour |
|---|---|---|
| `DEADLOCKED` | in a cycle of blocking edges | red + lock icon |
| `BLOCKED` | ≥1 blocking in-edge | red |
| `AT_RISK` | no blocking in-edge but ≥1 non-blocking in-edge (TOUCHES/INDIRECT/CO_LOCATED/AI logical risk) — "has dependencies" | yellow |
| `SAFE` | no in-edges | green |

`diffGraphs` reports `newlyUnblocked` = transitions from `BLOCKED|DEADLOCKED` to `SAFE|AT_RISK`.

## Layer 1 — the deterministic engine

### 1a. Patch parsing → base-coordinate change regions (`lib/graph/patch/`)

Two PRs branch from the same base, so their hunks must be compared in **base (`-`) coordinates, per
file**. Never compare `+` ranges, never compare hunks from different files (this was the Phase-2
heuristic bug).

```typescript
// parsePatch(patch) → { hunks, regions: ChangeRegion[], symbols: string[] }  (pure)
// Walk each hunk: ' ' advances base+head, '-' marks base line L as changed, '+' inserts at the gap
// before the next base line. A run of '-' lines → region [first, last]; a pure insertion → a
// zero-width region [L, L-1] anchored between base lines L-1 and L.
export interface ChangeRegion { start: number; end: number; preview: string[] } // end < start ⇒ insertion point

// regionsConflict(a, b): git's rule — overlapping OR adjacent regions conflict.
//   overlap/adjacent ⇔ a.start <= b.end + 1 && b.start <= a.end + 1
//   two insertions at the same point conflict; identical edits are still reported (conservative).
```

`previews` (≤ 6 lines per side) let the UI say *"both PRs change `return verify(t)` at auth.ts
L42–48"*. Validate the region rule with a **property test** (fast-check) against `node-diff3` on
random small files.

### 1b. Build (`lib/graph/buildDependencyGraph.ts`)

1. Inverted index `file → PRs` (skip regenerable files for BLOCKS).
2. For each pair sharing a file: classify the file — exact BLOCKS / TOUCHES from regions; approx
   BLOCKS when either patch is missing or `baseSha` differs.
3. Merge per-file results into one edge per pair; attach `conflicts[]` (file + regions + previews).
4. Add `STACKED` edges (`stacks.ts`) and `SEMANTIC` edges (`symbols/impactEdges`).
5. Cycles (DFS 3-colour) + in-degree over **blocking** edges → status; Kahn levels over blocking edges.
6. `INDIRECT` edges (`indirect.ts`) for display; `transitivelyBlockedBy` on node data.
7. `schemaVersion: 2`; stats count every edge in `totalDependencies` and blocking ones in
   `blockingDependencies`.

### 1c. Cross-file symbol impact (`lib/graph/symbols/`)

- `languages.ts`: definition regexes per extension (TS/JS, Python, Go, Java/Kotlin, Rust, Ruby, C#,
  PHP), a keyword stop-list, min symbol length 3.
- `extractFacts(file)`: `defs` (`added | removed | renamed | signature | body`) from removed/added
  definition lines in the same hunk (+ hunk-header context), `refs` = identifiers in **added** lines.
- `impactEdges(prs)`: A's `removed|renamed|signature` def ∩ B's new refs (B ≠ A, ref in a file A did
  not define it in) → `SEMANTIC` A→B, `severity: "high"`, `certainty: "approx"`,
  `symbols: [{ name, change, defFile, refFile }]`. A `body`-only change never creates an edge.
- Graded offline by `evals/impact.eval.ts` against `evals/impact-pairs.json` (F1 ≥ 0.75 gate +
  5-point regression guard vs `evals/impact-baseline.json`).

### 1d. Tier-2 deep verify (`lib/graph/mergeSim.ts`, pure; blobs fetched by the backend)

For approx edges caused by base drift: `simulateSequentialMerge({ mergeBaseA, headA, mergeBaseB,
headB, baseTip })` with `node-diff3` — merge A onto the base tip, then check whether B conflicts.
Returns exact regions (`evidence: "diff3"`, `certainty: "exact"`) or "clean" (→ TOUCHES). Applied by
the pure `applyDeepVerdicts(graph, results)`. Bounded by `MERGE_SIM_MAX_PAIRS` (backend).

## Layer 2 — the AI analyzer (provider-agnostic, cached, fallback)

Pipeline (`lib/ai/conflictAnalyzer.ts`): content-addressed cache → `LLMAdapter` → Zod
`VerdictSchema` → heuristic fallback. `analyzeOrFallback` never throws and respects `AI_ENABLED`, the
per-repo `aiEnabled` setting (can only turn AI *off*) and the daily budget breaker.

```typescript
export const VerdictSchema = z.object({
  verdict: z.enum(['TRUE_CONFLICT', 'CO_LOCATED', 'UNCERTAIN']),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(400),
  resolution: z.string().max(400).optional(),   // conflict.v4+: suggested resolution
});
```

- **Prompts are versioned files**; the active version (`conflict.v4`) feeds only the conflicting
  regions + context (fewer tokens than whole patches). `conflict.v3` stays registered so both can be
  evaluated. SEMANTIC edges go through the same `conflict.v4` prompt with their symbol links in the
  FOCUS notes (def file diff for side A, ref file diff for side B). The provider is part of the cache
  key; `npm run eval -- --provider <spec> --prompt <version>` runs model / prompt A/B tests.
- **Cache key:** `ai:verdict:{promptVersion}:{sha256(sortedSharedFiles + diffA + diffB + focus + provider)}`, TTL 7 days,
  every cache op timeout-guarded (400 ms) so a slow Redis degrades instead of hanging.
- **Heuristic** (`lib/ai/heuristic.ts`) reuses `parsePatch`/`regionsConflict` **per file in base
  coordinates**: overlap → TRUE_CONFLICT, disjoint → CO_LOCATED, unparseable → UNCERTAIN.
- **Applying verdicts** (`refineGraph`, pure): demote only `certainty: "approx"` edges on
  CO_LOCATED; annotate exact edges with `explanation`/`resolution`; on a TOUCHES edge a TRUE_CONFLICT
  verdict sets `semanticVerdict` and keeps it non-blocking (target becomes AT_RISK). Then re-derive
  status / cycles / Kahn / stats.

## Layer 3 — planning (pure)

- **Readiness** (`lib/graph/readiness.ts`): `toReadiness(raw)` →
  `{ ci: success|failure|pending|none, failingChecks, review: approved|changes_requested|review_required|none,
  mergeable: clean|conflicting|unknown, draft, missingRequiredChecks, state: READY|WAITING|NOT_READY,
  score 0–100, reasons[] }`. READY = CI green (or none required) + approved (or not required) + not
  draft + mergeable not conflicting.
- **Merge plan** (`lib/graph/mergePlan.ts`): `planMerges(graph, readinessById)` → steps; each step is
  a **maximal batch of mutually independent READY PRs** (no blocking edge among them and all
  blockers merged in earlier steps), greedy by priority = transitive dependents ↓, readiness score ↓,
  createdAt ↑, number ↑. Not-ready PRs go to `parked` with reasons; PRs waiting on parked ones are
  listed as `waitingOn`. `criticalPath` = longest blocking path (DP over Kahn order). Each step gets a
  plain-English `rationale`. Kahn levels remain available as the secondary "levels" view.
- **What-if** (`lib/graph/whatIf.ts`): `whatIfMerge(graph, prIds)` removes the PRs and their edges,
  re-derives statuses, returns `StatusChange[]` (who becomes SAFE / AT_RISK).
- **Preflight** (`lib/graph/preflight.ts`): `preflight(prs, candidate)` treats a candidate change
  (unified diff or file list with ranges) as a virtual newest PR `#0` and runs the *same* region,
  regenerable and symbol classifiers against stored PR facts — never rebuilds the whole graph. Returns
  `{ collisions[], risk: none|low|high, waitFor[], recommendation }`.
- **Workspaces** (`lib/graph/workspaces.ts`): detect `apps/* | packages/* | services/* | libs/*`
  (or configured globs) per file → `node.data.workspaces`; `aggregateByWorkspace(graph)` collapses to
  a workspace-level graph for monorepos.
- **Export** (`lib/graph/export.ts`): `toMermaid(graph)` (stable ids, escaped titles).
- **Normalize** (`lib/graph/normalize.ts`): `normalizeGraph(json)` upgrades v1 snapshots/cache
  entries (`CRITICAL_BLOCK` → BLOCKS + critical, missing `blocking` derived from type).

## Model choice — current, honest, defensible

- **Default = GPT-5.4-mini** via `LLM_PROVIDER=openai:gpt-5.4-mini`: conflict analysis is a short
  structured classification; a mini, coding-capable tier is the right price/quality point.
- **Second providers behind the same adapter:** `anthropic:<model>` (official SDK — look up the
  current model id with the `claude-api` skill, never hardcode it outside the provider spec) and
  `ollama:<model>` (OpenAI-compatible `baseURL`, zero per-call cost). Escalate only on `UNCERTAIN`.
- **The real decision is the adapter, not the vendor.** Defend the default with eval numbers (F1 vs
  cost) recorded in `docs/AI_ARCHITECTURE.md` — only numbers actually measured; unrun cells say so.

## The MLOps wrapper

| Component | Where | Purpose |
|---|---|---|
| Provider-agnostic `LLMAdapter` | `lib/ai/adapters/*` (openai, anthropic, ollama) | one interface, swappable backends |
| Versioned prompt registry | `lib/ai/prompts/*` | prompts are files; version is in the cache key + eval |
| Content-addressed cache | Redis | `sha256(files+diffA+diffB)` per prompt version; dominant cost lever |
| Eval harnesses gating CI | `evals/conflict.eval.ts`, `evals/impact.eval.ts` | precision/recall/F1 vs labeled fixtures; fail on threshold or >5pt regression |
| Cost/latency telemetry + budget breaker | Prometheus | `prgraph_llm_*`, `prgraph_ai_*`; trip to fallback past `LLM_DAILY_BUDGET_USD` |

## Testing requirements

- Every pure module has a Vitest suite under `src/lib/graph/__tests__/` with hand-built fixtures
  (patches as template strings). Cover: insertion-vs-deletion adjacency, identical edits, missing
  patch, base drift, regenerable files, stacked chains, semantic cycles, merge-plan batching with
  parked PRs, what-if transitions, preflight on a candidate, v1 → v2 normalization.
- Property test: `regionsConflict` ≡ `node-diff3` conflict decision on random small files.
- The demo fixture repo (`lib/demo/fixtures.ts`) must exercise every edge type and status; the E2E
  suite asserts on it, so changing classification rules means updating the demo expectations.

## Anti-patterns to fix on sight

| Anti-pattern | Fix |
|---|---|
| I/O, `Date.now`, randomness, or unstable ordering in `lib/graph/**` | keep it pure; inject inputs; sort with explicit tie-breaks |
| Comparing `+` (new-side) ranges, or hunks across different files | base (`-`) coordinates, per file |
| Classifying edges by shared-file *count* | classify by change-region overlap per file |
| Letting the LLM demote an exact textual conflict, or add a blocking edge | AI only demotes approx evidence; logical risk → AT_RISK |
| Running the LLM on all N² pairs | only on edges the engine produced |
| `JSON.parse(rawLLM)` straight into the graph | Zod-validate; heuristic on failure |
| Caching by PR number / time | content-address on prompt version + diffs |
| Hardcoding `openai(...)` or a model id | `LLMAdapter` + `LLM_PROVIDER` spec |
| Rebuilding the whole graph for a preflight request | `preflight()` against stored PR facts |
| Topo sort / cycles as SQL CTEs | in-memory TypeScript, persist the result |
| Reading old snapshots without `normalizeGraph` | always normalize at the read boundary |

## Scaling notes

The engine is O(Σ files + pairs-per-hot-file²) per recompute. At scale it runs incrementally over
per-PR facts cached by `headSha` (immutable) and caps hot-file pair explosion — see
[`SCALING.md`](../../../SCALING.md) §4 and §9.

## Quick reference

- Three layers: deterministic engine → AI refinement (approx evidence only) → planning.
- Engine: index → base-coordinate regions per file → BLOCKS/TOUCHES (+approx) → SEMANTIC + STACKED →
  status over blocking edges (SAFE/AT_RISK/BLOCKED/DEADLOCKED) → Kahn → DFS → INDIRECT.
- Deep verify: diff3 sequential merge upgrades approx → exact.
- AI: adapter → Zod verdict (+resolution) → content-addressed cache → heuristic fallback.
- Planning: readiness → `planMerges` batches + critical path; `whatIfMerge`; `preflight`.
- Runnable starter + eval harness → `PRGraph_starter_code.md`; wiring → `PRGraph_eval_connectors.md`;
  backend wiring (fetching, queue, socket, Check Run, preflight API) → prgraph-nextjs-backend.
