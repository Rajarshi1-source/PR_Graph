import type { ConflictInput } from "../types";
import type { Prompt } from "../adapters/types";
import * as v3 from "./conflict.v3";
import * as v4 from "./conflict.v4";

export interface PromptTemplate {
  version: string;
  buildSystem: () => string;
  buildUser: (input: ConflictInput) => string;
  buildPrompt: (input: ConflictInput) => Prompt;
}

const template = (m: typeof v3 | typeof v4): PromptTemplate => ({
  version: m.PROMPT_VERSION,
  buildSystem: m.buildSystem,
  buildUser: m.buildUser,
  buildPrompt: m.buildPrompt,
});

/**
 * Versioned prompt registry — add new versions here; the active one is content-key material.
 * v3 stays registered so `npm run eval -- --prompt conflict.v3` can compare versions on one set.
 */
const registry: Record<string, PromptTemplate> = {
  [v3.PROMPT_VERSION]: template(v3),
  [v4.PROMPT_VERSION]: template(v4),
};

export const ACTIVE_PROMPT_VERSION = v4.PROMPT_VERSION;

export function getPrompt(version: string = ACTIVE_PROMPT_VERSION): PromptTemplate {
  const tmpl = registry[version];
  if (!tmpl) throw new Error(`Unknown prompt version: ${version}`);
  return tmpl;
}

export function promptVersions(): string[] {
  return Object.keys(registry).sort();
}
