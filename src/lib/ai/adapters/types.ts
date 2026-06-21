/**
 * Provider-agnostic LLM adapter (PRGraph_eval_connectors.md §2, prgraph-graph-ai MLOps wrapper).
 * The rest of the AI layer depends ONLY on this interface — never on a vendor SDK or model string.
 * Swapping providers (openai / anthropic / ollama) is a one-line config change via the factory.
 */
export interface Prompt {
  system?: string;
  user: string;
}

export interface LLMAdapter {
  /** e.g. "openai:gpt-5.4-mini" — used for telemetry labels and the model-choice justification. */
  readonly name: string;
  /** Returns parsed JSON (defensive fence-stripping inside); throws on transport/parse failure. */
  completeJSON(prompt: Prompt, opts?: { maxTokens?: number }): Promise<unknown>;
  /** Estimated USD cost for a call given token counts (drives the budget breaker + cost metric). */
  estimateCostUsd(inTok: number, outTok: number): number;
}
