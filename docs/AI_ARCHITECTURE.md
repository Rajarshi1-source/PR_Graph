# AI architecture — semantic conflict analysis

PRGraph's AI layer is a **refinement** on top of a deterministic engine, never a replacement. This
document explains where the LLM sits, what it is allowed to change, how it is evaluated, and how
the default model is chosen. Engine rules: [`.claude/skills/prgraph-graph-ai/SKILL.md`](../.claude/skills/prgraph-graph-ai/SKILL.md).

## Where the LLM sits

```
open PRs + patches
   │
   ▼  Layer 1 — deterministic (always on, pure, unit + property tested)
   │   per-file change regions in base coordinates → BLOCKS / TOUCHES (exact)
   │   missing patch / base drift → BLOCKS (approx) → diff3 deep verify → exact
   │   cross-file symbol impact → SEMANTIC (approx) · stacked branches → STACKED (exact)
   ▼
   │  Layer 2 — AI refinement (optional: AI_ENABLED + per-repo aiEnabled)
   │   cache → LLMAdapter → Zod VerdictSchema → heuristic fallback
   │   • approx BLOCKS / SEMANTIC + CO_LOCATED verdict → demoted to non-blocking
   │   • exact BLOCKS → annotated (explanation + suggested resolution), never demoted
   │   • clean TOUCHES + TRUE_CONFLICT verdict → logical-risk note, stays non-blocking (AT_RISK)
   ▼
   │  Layer 3 — planning (pure): readiness → merge plan, what-if, preflight
```

Three rules make this safe:

1. **An exact textual conflict is a fact.** If base-coordinate regions overlap (or diff3 conflicts),
   git *will* conflict; a model cannot argue it away.
2. **The AI can only soften.** It may demote approximate evidence; it never adds a blocking edge.
3. **Failure degrades to deterministic.** Disabled, over budget, timeout, malformed output → the
   heuristic verdict for that edge; the graph always ships.

## Components

| Component | Where | Notes |
|---|---|---|
| Provider-agnostic adapter | `src/lib/ai/adapters/` | `openai` (default), `anthropic`, `ollama` — selected by `LLM_PROVIDER=vendor:model`; the model id always comes from config |
| Versioned prompts | `src/lib/ai/prompts/` | `conflict.v4` (active: engine FOCUS notes + `resolution`), `conflict.v3` (kept for A/B) |
| Verdict schema | `src/lib/ai/types.ts` | Zod: verdict, confidence, explanation ≤ 400, optional resolution ≤ 400 |
| Content-addressed cache | `src/lib/ai/cache.ts` | `ai:verdict:{prompt}:{sha256(files, diffs, focus, provider)}`, 7-day TTL, 400 ms op timeout |
| Budget breaker | `src/lib/ai/budget.ts` | daily USD counter; `LLM_DAILY_BUDGET_USD` |
| Heuristic fallback | `src/lib/ai/heuristic.ts` | per-file base-coordinate regions + cross-file symbol impact |
| Telemetry | `src/lib/metrics.ts` | `prgraph_llm_*`, `prgraph_ai_*` (Grafana "AI" row) |

## Evaluation

Two offline, deterministic eval sets gate CI; the conflict set additionally gates the model when a
key is configured.

| Eval | Grades | Fixtures | Gate |
|---|---|---|---|
| `npm run eval` | the shipping `analyzeConflict` (heuristic when AI is off) | `evals/labeled-pairs.json` (36) | F1 ≥ 0.60 offline / ≥ 0.80 with AI, ≤ 5 pt regression vs `evals/baseline.json` |
| `npm run eval:impact` | the cross-file symbol detector (`impactLinks`) | `evals/impact-pairs.json` (22) | F1 ≥ 0.75, ≤ 5 pt regression vs `evals/impact-baseline.json` |

Flags for experiments: `--provider <vendor:model>` and `--prompt <version>` (e.g.
`AI_ENABLED=true npm run eval -- --provider anthropic:<model> --prompt conflict.v3`). The provider is
part of the cache key, so runs never read another model's verdicts.

## Measured results

Only numbers actually produced in this repository are recorded here.

| Configuration | Eval | Precision | Recall | F1 | Accuracy | Notes |
|---|---|---|---|---|---|---|
| Heuristic, Phase 2 (`+` ranges, files mixed) | conflict (36) | 0.857 | 0.857 | 0.857 | 0.889 | previous baseline, 2026-06-21 |
| Heuristic, Phase 3 (base-coordinate, per file, + symbol impact) | conflict (36) | 0.929 | 0.929 | 0.929 | 0.944 | current `evals/baseline.json` |
| `impactLinks` (deterministic) | impact (22) | 1.000 | 1.000 | 1.000 | 1.000 | see caveat below |
| `openai:gpt-5.4-mini` · `conflict.v4` | conflict (36) | not run | — | — | — | needs `OPENAI_API_KEY`; CI's `eval-ai` job runs it when the secret exists |
| `anthropic:<model>` · `conflict.v4` | conflict (36) | not run | — | — | — | needs `ANTHROPIC_API_KEY` |
| `ollama:<model>` · `conflict.v4` | conflict (36) | not run | — | — | — | needs a local Ollama |

**Caveats.** The impact fixtures were written alongside the detector, so the 1.000 shows that the
labeled behaviours are implemented and protected against regressions — not that the detector
generalises. Growing that set with pairs from real repositories is the next step before quoting it.
The two heuristic misses on the conflict set are instructive: `adjacent-overlap` (two insertions two
lines apart in the same function — merges cleanly, but the label says the change is semantically
coupled) and `reformat-vs-edit-overlap` (adjacent edits that git *does* conflict on, labeled
independent). Those are exactly the cases the LLM exists for.

## Choosing the default model

The decision is made on the eval, not by vendor:

1. Run the conflict eval for each candidate (`--provider`), with the active prompt.
2. Record precision / recall / F1 and the measured `prgraph_llm_cost_usd_total` per run here.
3. Pick the cheapest model that clears F1 ≥ 0.80 with no regression; escalate to a larger tier only
   on `UNCERTAIN` verdicts.
4. Re-run on every prompt change (CI does this automatically when keys are configured).

Until the model rows above are filled in from real runs, the shipped default is
`openai:gpt-5.4-mini` with `AI_ENABLED=false` — i.e. production runs the measured heuristic.
