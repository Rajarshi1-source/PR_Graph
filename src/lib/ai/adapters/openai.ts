import OpenAI from "openai";
import { env } from "@/lib/env";
import { AbstractLLMAdapter } from "./base";
import type { Prompt } from "./types";

/**
 * Concrete OpenAI adapter (default tier: gpt-5.4-mini — short structured classification over two
 * diffs; see prgraph-graph-ai "Model choice"). Reproducible by design: temperature 0 + JSON mode,
 * so identical diff pairs cache to identical verdicts and the eval is stable run-to-run.
 */
export class OpenAIAdapter extends AbstractLLMAdapter {
  readonly name: string;
  private client: OpenAI;

  constructor(private model = "gpt-5.4-mini") {
    super();
    this.name = `openai:${model}`;
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  protected async callRaw(prompt: Prompt, opts?: { maxTokens?: number }) {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      max_completion_tokens: opts?.maxTokens ?? 300,
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

  // gpt-5.4-mini approx: $0.75 / M input tokens, $4.50 / M output tokens.
  estimateCostUsd(inTok: number, outTok: number): number {
    return (inTok * 0.75 + outTok * 4.5) / 1_000_000;
  }
}
