import type { ConflictInput } from "../types";

/**
 * Versioned prompt (PRGraph_eval_connectors.md §1). The version string is part of the cache key,
 * so changing the prompt automatically invalidates cached verdicts.
 */
export const PROMPT_VERSION = "conflict.v3";

export function buildSystem(): string {
  return [
    "You are a senior code reviewer judging whether two pull requests that edit the same files",
    "TRULY conflict (incompatible logic) or are merely CO_LOCATED (same file, independent regions).",
    "Respond ONLY with strict JSON: {\"verdict\": \"TRUE_CONFLICT\"|\"CO_LOCATED\"|\"UNCERTAIN\",",
    '"confidence": 0..1, "explanation": "<=600 chars"}. No prose outside the JSON.',
  ].join(" ");
}

export function buildUser(input: ConflictInput): string {
  return [
    `Shared files: ${input.sharedFiles.join(", ")}`,
    "",
    `--- PR #${input.prA} diff ---`,
    input.diffA.slice(0, 6000),
    "",
    `--- PR #${input.prB} diff ---`,
    input.diffB.slice(0, 6000),
  ].join("\n");
}
