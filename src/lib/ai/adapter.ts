import { env } from "@/lib/env";

/**
 * Provider-agnostic LLM adapter (PRGraph_eval_connectors.md §2). The rest of the AI layer depends
 * only on this interface — never on a specific vendor SDK or model string.
 */
export interface LLMResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

export interface LLMAdapter {
  readonly id: string;
  complete(system: string, user: string, opts?: { maxTokens?: number }): Promise<LLMResult>;
}

/**
 * MVP placeholder adapter. Phase 2 is deferred, so this is intentionally NOT wired to a live LLM —
 * it throws, which the analyzer treats as a failure and falls back to the deterministic heuristic.
 * Replace `complete` with a real provider call (OpenAI/Anthropic/etc.) to enable Phase 2.
 */
class UnwiredAdapter implements LLMAdapter {
  constructor(readonly id: string) {}
  async complete(): Promise<LLMResult> {
    throw new Error(`LLM provider "${this.id}" is not wired up in the MVP (AI Phase 2 deferred).`);
  }
}

export function createAdapter(spec: string = env.LLM_PROVIDER): LLMAdapter {
  // spec is "provider:model", e.g. "openai:gpt-5.4-mini".
  return new UnwiredAdapter(spec);
}
