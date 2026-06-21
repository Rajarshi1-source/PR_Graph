import { llmLatency, llmTokens, llmCostUsd } from "@/lib/metrics";
import { recordSpend } from "../budget";
import type { LLMAdapter, Prompt } from "./types";

/**
 * Shared adapter behaviour (PRGraph_eval_connectors.md §2): JSON-mode call, defensive
 * fence-stripping, and the cost/latency/token telemetry + daily-spend accounting that power the
 * MLOps wrapper. Concrete adapters implement only `callRaw` + `estimateCostUsd`.
 */
export abstract class AbstractLLMAdapter implements LLMAdapter {
  abstract readonly name: string;

  protected abstract callRaw(
    prompt: Prompt,
    opts?: { maxTokens?: number },
  ): Promise<{ text: string; inTok: number; outTok: number }>;

  abstract estimateCostUsd(inTok: number, outTok: number): number;

  async completeJSON(prompt: Prompt, opts?: { maxTokens?: number }): Promise<unknown> {
    const t0 = Date.now();
    const { text, inTok, outTok } = await this.callRaw(prompt, opts);

    llmLatency.observe({ provider: this.name }, Date.now() - t0);
    llmTokens.inc({ provider: this.name }, inTok + outTok);
    const cost = this.estimateCostUsd(inTok, outTok);
    llmCostUsd.inc({ provider: this.name }, cost);
    // Accrue against the daily budget so the breaker can trip (best-effort; never blocks the call).
    await recordSpend(cost).catch(() => {});

    return JSON.parse(stripFences(text));
  }
}

/** Strip Markdown code fences and isolate the outermost JSON object from a model response. */
export function stripFences(s: string): string {
  let t = (s ?? "").trim();
  if (t.startsWith("```")) t = t.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  return i >= 0 && j > i ? t.slice(i, j + 1) : t;
}
