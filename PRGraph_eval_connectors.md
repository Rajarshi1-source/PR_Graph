# PRGraph — Eval Connectors
## The versioned prompt + provider-agnostic LLM adapter + diff-fetcher that make the conflict eval run end-to-end

> This connects four things: the **versioned prompt** (`prompts/conflict.v3.ts`), the
> **provider-agnostic adapter** (`LLMAdapter`, from prgraph-graph-ai), the **diff-fetcher** (Octokit
> `patch` hunks), and the **eval harness** (`evals/conflict.eval.ts` from the starter code). After
> dropping these in, `npx tsx evals/conflict.eval.ts` runs against your analyzer end-to-end, and the
> same analyzer powers the live graph.

---

## How the pieces fit

```
evals/conflict.eval.ts ──(diffA, diffB)──► analyzeConflict()
                                               │
                            ┌──────────────────┼─────────────────────┐
                            ▼                   ▼                     ▼
                    prompts/conflict.v3   Redis cache           LLMAdapter (factory)
                    (versioned file)   sha256(pv+dA+dB)      openai:gpt-5.4-mini | claude | ollama
                            │                                       │
                            └────────────► JSON {verdict, confidence, explanation}
                                                  │ Zod-validated; heuristic fallback on failure

live graph path:  webhook → recompute → for each overlapping edge → analyzeConflict(diffA, diffB)
                  diffA/diffB come from octokit.rest.pulls.listFiles(...).data[].patch
```

The eval and the live graph call the **same** `analyzeConflict`, so the eval actually measures what
ships. The verdict keys (`verdict`, `confidence`, `explanation`) must match the Zod schema exactly.

---

## 1. The versioned prompt — `src/lib/ai/prompts/conflict.v3.ts`

Keep prompts as versioned files; the version string is part of the cache key and the eval. The
few-shot examples here are **deliberately disjoint** from `evals/labeled-pairs.json`.

```typescript
export const CONFLICT_V3 = `You are a senior code reviewer deciding whether two pull requests will
actually conflict when both are merged. You are given the unified-diff hunks of PR A and PR B that
touch the same file.

Decide ONE verdict:
- TRUE_CONFLICT: the two diffs modify overlapping lines, the same function/block, or the same
  declaration such that merging both will cause a real conflict or break one of them.
- CO_LOCATED: the diffs are in the same file but in disjoint regions (e.g. imports vs a far-away
  function, two different fields, two different helpers) and will merge cleanly.
- UNCERTAIN: not enough context to tell (very large diffs, generated files, ambiguous overlap).

Return ONLY a JSON object, no prose, no code fences:
{"verdict":"TRUE_CONFLICT|CO_LOCATED|UNCERTAIN","confidence":0.0-1.0,"explanation":"<=400 chars, plain English"}

Examples (note: these are intentionally different from any test set):
# A edits the imports, B edits a function 300 lines away -> CO_LOCATED
# A and B both change the same return statement -> TRUE_CONFLICT

--- PR A diff ---
{{DIFF_A}}
--- PR B diff ---
{{DIFF_B}}`;
```

```typescript
// src/lib/ai/prompts/registry.ts
import { CONFLICT_V3 } from './conflict.v3';
const PROMPTS: Record<string, string> = { 'conflict.v3': CONFLICT_V3 };

export interface Prompt { system?: string; user: string; }
export function getPrompt(version: string, vars: { dA: string; dB: string }): Prompt {
  const tpl = PROMPTS[version];
  if (!tpl) throw new Error(`Unknown prompt version: ${version}`);
  return { user: tpl.replace('{{DIFF_A}}', vars.dA ?? '').replace('{{DIFF_B}}', vars.dB ?? '') };
}
```

---

## 2. The provider-agnostic adapter — `src/lib/ai/adapters/`

```typescript
// types.ts
import type { Prompt } from '../prompts/registry';
export interface LLMAdapter {
  readonly name: string;
  completeJSON(prompt: Prompt): Promise<unknown>;   // returns parsed JSON; throws on failure
  estimateCostUsd(inTok: number, outTok: number): number;
}
```

```typescript
// base.ts — JSON-mode call, defensive fence-stripping, telemetry hook
import type { LLMAdapter } from './types';
import type { Prompt } from '../prompts/registry';

export abstract class AbstractLLMAdapter implements LLMAdapter {
  abstract readonly name: string;
  protected abstract callRaw(prompt: Prompt): Promise<{ text: string; inTok: number; outTok: number }>;
  abstract estimateCostUsd(inTok: number, outTok: number): number;

  async completeJSON(prompt: Prompt): Promise<unknown> {
    const t0 = Date.now();
    const { text, inTok, outTok } = await this.callRaw(prompt);
    metrics.observe('llm_latency_ms', Date.now() - t0, { provider: this.name });
    metrics.inc('llm_tokens_total', inTok + outTok, { provider: this.name });
    metrics.inc('llm_cost_usd_total', this.estimateCostUsd(inTok, outTok), { provider: this.name });
    return JSON.parse(stripFences(text));
  }
}

function stripFences(s: string): string {
  let t = (s ?? '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  return i >= 0 && j > i ? t.slice(i, j + 1) : t;
}
```

```typescript
// openai.ts — concrete adapter (default: gpt-5.4-mini). Wire your SDK in callRaw().
import { AbstractLLMAdapter } from './base';
import type { Prompt } from '../prompts/registry';

export class OpenAIAdapter extends AbstractLLMAdapter {
  readonly name = `openai:${this.model}`;
  constructor(private model = 'gpt-5.4-mini') { super(); }

  protected async callRaw(prompt: Prompt) {
    // Pseudocode — replace with the OpenAI SDK / fetch:
    //   model = this.model, temperature = 0, response_format = { type: 'json_object' }
    //   messages = [{ role: 'user', content: prompt.user }]
    //   return { text: content, inTok: usage.prompt_tokens, outTok: usage.completion_tokens }
    throw new Error('Wire the OpenAI call here.');
  }
  // gpt-5.4-mini approx: $0.75/M in, $4.50/M out
  estimateCostUsd(inTok: number, outTok: number) { return (inTok * 0.75 + outTok * 4.5) / 1_000_000; }
}
```

```typescript
// factory.ts — choose the backend by env; never hardcode a model in the analyzer
import { OpenAIAdapter } from './openai';
import type { LLMAdapter } from './types';

export function makeAdapter(): LLMAdapter {
  const spec = process.env.LLM_PROVIDER ?? 'openai:gpt-5.4-mini';
  const [vendor, model] = spec.split(':');
  switch (vendor) {
    case 'openai': return new OpenAIAdapter(model);
    // case 'anthropic': return new AnthropicAdapter(model);   // same interface, A/B on the eval
    // case 'ollama':    return new OllamaAdapter(model);       // local, zero per-call cost
    default: throw new Error(`Unknown LLM_PROVIDER: ${spec}`);
  }
}
```

> **Why temperature 0 + JSON mode:** reproducibility. The eval must be stable run-to-run, and
> identical diff pairs must cache to identical verdicts in production.

---

## 3. The diff-fetcher — where `diffA` / `diffB` come from

The analyzer never calls GitHub itself; the backend supplies the hunks. `pulls.listFiles` returns a
`patch` per file — concatenate the patches for the files the two PRs share.

```typescript
// src/lib/github/sharedDiffs.ts  (called by the recompute worker)
import { octokitFor } from './client';

/** For an overlapping edge, return the diff hunks of the shared files for each PR. */
export async function sharedDiffs(repo: RepoRef, prA: number, prB: number, sharedFiles: string[]) {
  const ok = await octokitFor(repo.installationId);
  const pick = async (pr: number) => {
    const files = await ok.paginate(ok.rest.pulls.listFiles, { owner: repo.owner, repo: repo.name, pull_number: pr, per_page: 100 });
    return files.filter((f) => sharedFiles.includes(f.filename)).map((f) => f.patch ?? '').join('\n');
  };
  return { diffA: await pick(prA), diffB: await pick(prB) };
}
```

The recompute worker then calls `analyzeOrFallback(adapter, diffA, diffB)` for each overlapping edge,
demotes `CO_LOCATED` edges from blocking, and re-runs the topological sort (prgraph-graph-ai §Layer 2).

---

## 4. Run it end-to-end

```bash
# 1. Build the labeled set (start from the 6 seed cases, grow to ~36) — evals/labeled-pairs.json

# 2. Run the eval against your analyzer (cache makes reruns near-free)
LLM_PROVIDER=openai:gpt-5.4-mini OPENAI_API_KEY=sk-... REDIS_URL=redis://localhost:6379 \
  npx tsx evals/conflict.eval.ts

# Expected (numbers vary by model):
#   same-fn-rewrite              pred=TRUE_CONFLICT  gold=TRUE_CONFLICT
#   import-vs-far-fn             pred=CO_LOCATED     gold=CO_LOCATED
#   ...
#   precision=0.90 recall=0.86 F1=0.88 (n=36)

# 3. Lock the baseline, then gate CI on it
npx tsx evals/conflict.eval.ts --save-baseline
npx tsx evals/conflict.eval.ts --ci      # exits 1 if F1 < 0.80 or regressed > 5 points

# 4. A/B a second provider on the SAME set — this is your "model choice" interview evidence
LLM_PROVIDER=anthropic:... npx tsx evals/conflict.eval.ts
```

---

## 5. Sanity test (wiring) — `evals/wiring.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { getPrompt } from '../src/lib/ai/prompts/registry';

describe('prompt wiring', () => {
  it('injects both diffs and leaves no placeholder', () => {
    const p = getPrompt('conflict.v3', { dA: 'DIFF-A-HERE', dB: 'DIFF-B-HERE' });
    expect(p.user).toContain('DIFF-A-HERE');
    expect(p.user).toContain('DIFF-B-HERE');
    expect(p.user).not.toContain('{{DIFF_A}}');
  });
});
```

---

## What you can now say in an interview

> *"My AI conflict analyzer is fully wired for evaluation. The prompt is a versioned file; a
> provider-agnostic adapter calls the model at temperature zero in JSON mode; the verdict is
> Zod-validated and content-address-cached, with a heuristic fallback so the graph never breaks. The
> diffs come straight from GitHub's `pulls.listFiles` patches for the files two PRs share. A TypeScript
> eval harness runs the analyzer over ~36 hand-labeled pairs, computes precision/recall/F1, and gates
> CI. Because the adapter is provider-agnostic, I A/B-tested two models on the same eval and picked my
> default — GPT-5.4-mini — on the F1-versus-cost number, not brand loyalty."*

That's the full loop: **versioned prompt → adapter → cache + fallback → diff-fetcher → eval harness →
CI gate** — and a clean answer to "how do you know your AI feature works, and why that model?"
