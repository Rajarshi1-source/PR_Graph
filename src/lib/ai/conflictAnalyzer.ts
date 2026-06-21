import { env } from "@/lib/env";
import { VerdictSchema, type ConflictInput, type ConflictVerdict, type VerdictSource } from "./types";
import { heuristicVerdict } from "./heuristic";
import { createAdapter } from "./adapter";
import { getPrompt, ACTIVE_PROMPT_VERSION } from "./prompts/registry";
import { getCachedVerdict, setCachedVerdict, verdictKey } from "./cache";

export type AnalyzedVerdict = ConflictVerdict & { source: VerdictSource };

/**
 * Phase-2 entry point (plan §14). Pipeline: content-addressed cache → AI (if enabled) → Zod
 * validation → heuristic fallback. AI failure NEVER breaks the graph; it degrades to deterministic.
 *
 * Deferred: the adapter is intentionally unwired in the MVP, so with AI_ENABLED=false (default)
 * this always returns the heuristic verdict. Wiring a real adapter is all that's needed to enable it.
 */
export async function analyzeConflict(input: ConflictInput): Promise<AnalyzedVerdict> {
  const key = verdictKey(ACTIVE_PROMPT_VERSION, input);

  const cached = await getCachedVerdict(key).catch(() => null);
  if (cached) return { ...cached, source: "cache" };

  let verdict: ConflictVerdict;
  let source: VerdictSource;

  if (env.AI_ENABLED) {
    try {
      verdict = await runAI(input);
      source = "ai";
    } catch {
      verdict = heuristicVerdict(input);
      source = "heuristic";
    }
  } else {
    verdict = heuristicVerdict(input);
    source = "heuristic";
  }

  await setCachedVerdict(key, verdict).catch(() => {});
  return { ...verdict, source };
}

async function runAI(input: ConflictInput): Promise<ConflictVerdict> {
  const prompt = getPrompt();
  const adapter = createAdapter();
  const result = await adapter.complete(prompt.buildSystem(), prompt.buildUser(input), {
    maxTokens: 300,
  });
  // Validate strictly — malformed JSON throws and the caller falls back to the heuristic.
  return VerdictSchema.parse(JSON.parse(result.text));
}
