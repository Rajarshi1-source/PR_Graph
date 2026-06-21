import { env } from "@/lib/env";
import { aiRequests, aiCacheHits, aiFallbacks, aiVerdicts } from "@/lib/metrics";
import { VerdictSchema, type ConflictInput, type ConflictVerdict, type VerdictSource } from "./types";
import { heuristicVerdict } from "./heuristic";
import { makeAdapter } from "./adapters/factory";
import { getPrompt, ACTIVE_PROMPT_VERSION } from "./prompts/registry";
import { getCachedVerdict, setCachedVerdict, verdictKey } from "./cache";
import { budgetExceeded } from "./budget";

export type AnalyzedVerdict = ConflictVerdict & { source: VerdictSource };

/**
 * Phase-2 entry point. Pipeline: content-addressed cache → AI (if enabled) → Zod validation →
 * heuristic fallback. AI failure NEVER breaks the graph; it degrades to deterministic.
 *
 * Prefer {@link analyzeOrFallback} from callers — it also short-circuits on the budget breaker and
 * emits the fallback telemetry. `analyzeConflict` is the path the eval grades.
 */
export async function analyzeConflict(input: ConflictInput): Promise<AnalyzedVerdict> {
  aiRequests.inc();

  // When AI is disabled the shipping verdict is the deterministic heuristic — no LLM, no cache/Redis
  // (the heuristic is free + deterministic, so caching it buys nothing). This is what the offline
  // eval grades and what runs in production with AI_ENABLED=false.
  if (!env.AI_ENABLED) {
    const verdict = heuristicVerdict(input);
    aiVerdicts.inc({ verdict: verdict.verdict, source: "heuristic" });
    return { ...verdict, source: "heuristic" };
  }

  const key = verdictKey(ACTIVE_PROMPT_VERSION, input);

  const cached = await getCachedVerdict(key).catch(() => null);
  if (cached) {
    aiCacheHits.inc();
    aiVerdicts.inc({ verdict: cached.verdict, source: "cache" });
    return { ...cached, source: "cache" };
  }

  let verdict: ConflictVerdict;
  let source: VerdictSource;
  try {
    verdict = await runAI(input);
    source = "ai";
  } catch {
    verdict = heuristicVerdict(input);
    source = "heuristic";
    aiFallbacks.inc({ reason: "ai_error" });
  }

  await setCachedVerdict(key, verdict).catch(() => {});
  aiVerdicts.inc({ verdict: verdict.verdict, source });
  return { ...verdict, source };
}

/**
 * Production wrapper used by the live graph recompute: respects AI_ENABLED and the daily budget
 * breaker before ever touching the model, and can never throw — any failure degrades to the
 * deterministic heuristic so the graph always ships.
 */
export async function analyzeOrFallback(input: ConflictInput): Promise<AnalyzedVerdict> {
  if (!env.AI_ENABLED) {
    return heuristicResult(input, "disabled");
  }
  if (await budgetExceeded().catch(() => false)) {
    return heuristicResult(input, "budget");
  }
  try {
    return await analyzeConflict(input);
  } catch {
    return heuristicResult(input, "ai_error");
  }
}

function heuristicResult(input: ConflictInput, reason: string): AnalyzedVerdict {
  const verdict = heuristicVerdict(input);
  aiFallbacks.inc({ reason });
  aiVerdicts.inc({ verdict: verdict.verdict, source: "heuristic" });
  return { ...verdict, source: "heuristic" };
}

async function runAI(input: ConflictInput): Promise<ConflictVerdict> {
  const prompt = getPrompt().buildPrompt(input);
  const adapter = makeAdapter();
  const raw = await adapter.completeJSON(prompt, { maxTokens: 300 });
  // Validate strictly — malformed output throws and the caller falls back to the heuristic.
  return VerdictSchema.parse(raw);
}
