import type { ConflictInput } from "../types";
import type { Prompt } from "../adapters/types";
import { PROMPT_VERSION, buildSystem, buildUser, buildPrompt } from "./conflict.v3";

export interface PromptTemplate {
  version: string;
  buildSystem: () => string;
  buildUser: (input: ConflictInput) => string;
  buildPrompt: (input: ConflictInput) => Prompt;
}

/** Versioned prompt registry — add new versions here; the active one is content-key material. */
const registry: Record<string, PromptTemplate> = {
  [PROMPT_VERSION]: { version: PROMPT_VERSION, buildSystem, buildUser, buildPrompt },
};

export const ACTIVE_PROMPT_VERSION = PROMPT_VERSION;

export function getPrompt(version: string = ACTIVE_PROMPT_VERSION): PromptTemplate {
  const tmpl = registry[version];
  if (!tmpl) throw new Error(`Unknown prompt version: ${version}`);
  return tmpl;
}
