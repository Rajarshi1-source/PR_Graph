import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { AbstractLLMAdapter } from "./base";
import type { Prompt } from "./types";

/**
 * Per-million-token USD prices (Anthropic first-party API, input / output) for the cost estimator
 * and budget breaker. Unknown models fall back to the most expensive listed tier so the breaker
 * errs on the side of tripping early.
 */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
};
const FALLBACK_PRICE: [number, number] = [10, 50];

/**
 * Anthropic adapter for the model-swap experiment (`LLM_PROVIDER=anthropic:<model-id>`). The model
 * is always taken from the provider spec — never defaulted here. Classification is short, so the
 * request runs at low effort; the base class parses + Zod-validates the JSON.
 */
export class AnthropicAdapter extends AbstractLLMAdapter {
  readonly name: string;
  private client: Anthropic;

  constructor(private model: string) {
    super();
    this.name = `anthropic:${model}`;
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  }

  protected async callRaw(prompt: Prompt, opts?: { maxTokens?: number }) {
    const res = await this.client.messages.create({
      model: this.model,
      // Current models think adaptively by default; leave headroom so thinking never truncates the JSON.
      max_tokens: Math.max(opts?.maxTokens ?? 300, 2048),
      output_config: { effort: "low" },
      ...(prompt.system ? { system: prompt.system } : {}),
      messages: [{ role: "user", content: prompt.user }],
    });
    if (res.stop_reason === "refusal") throw new Error("anthropic: request declined");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { text, inTok: res.usage.input_tokens, outTok: res.usage.output_tokens };
  }

  estimateCostUsd(inTok: number, outTok: number): number {
    const [i, o] = PRICES[this.model] ?? FALLBACK_PRICE;
    return (inTok * i + outTok * o) / 1_000_000;
  }
}
