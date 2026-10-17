import { env } from "@/lib/env";
import { OpenAIAdapter } from "./openai";
import { AnthropicAdapter } from "./anthropic";
import { OllamaAdapter } from "./ollama";
import type { LLMAdapter } from "./types";

/**
 * Choose the LLM backend by config (never hardcode a model in the analyzer). `spec` is
 * "vendor:model", e.g. "openai:gpt-5.4-mini". Add providers here; they share the same interface
 * so they can be A/B-tested on the eval set.
 */
export function makeAdapter(spec: string = env.LLM_PROVIDER): LLMAdapter {
  const [vendor, ...rest] = spec.split(":");
  const model = rest.join(":") || undefined;
  switch (vendor) {
    case "openai":
      return new OpenAIAdapter(model);
    case "anthropic":
      if (!model) throw new Error("LLM_PROVIDER anthropic needs a model id: anthropic:<model>");
      return new AnthropicAdapter(model);
    case "ollama":
      if (!model) throw new Error("LLM_PROVIDER ollama needs a model: ollama:<model>");
      return new OllamaAdapter(model);
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${spec}`);
  }
}
