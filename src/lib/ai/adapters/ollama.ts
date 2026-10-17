import OpenAI from "openai";
import { env } from "@/lib/env";
import { AbstractLLMAdapter } from "./base";
import type { Prompt } from "./types";

/**
 * Local model via Ollama's OpenAI-compatible endpoint (`LLM_PROVIDER=ollama:<model>`, e.g.
 * `ollama:qwen3-coder`). Zero per-call cost — useful as the self-hosted point on the eval's
 * F1-vs-cost curve. Reuses the `openai` SDK with a different base URL (no extra dependency).
 */
export class OllamaAdapter extends AbstractLLMAdapter {
  readonly name: string;
  private client: OpenAI;

  constructor(private model: string) {
    super();
    this.name = `ollama:${model}`;
    this.client = new OpenAI({ baseURL: env.OLLAMA_BASE_URL, apiKey: "ollama" });
  }

  protected async callRaw(prompt: Prompt, opts?: { maxTokens?: number }) {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: opts?.maxTokens ?? 300,
      messages: [
        ...(prompt.system ? [{ role: "system" as const, content: prompt.system }] : []),
        { role: "user" as const, content: prompt.user },
      ],
    });
    return {
      text: res.choices[0]?.message?.content ?? "",
      inTok: res.usage?.prompt_tokens ?? 0,
      outTok: res.usage?.completion_tokens ?? 0,
    };
  }

  estimateCostUsd(): number {
    return 0; // runs on your own hardware
  }
}
