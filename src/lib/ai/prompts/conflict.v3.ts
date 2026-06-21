import type { ConflictInput } from "../types";
import type { Prompt } from "../adapters/types";

/**
 * Versioned prompt (PRGraph_eval_connectors.md §1). The version string is part of the cache key and
 * the eval, so a prompt change is a code change that invalidates cached verdicts. The few-shots are
 * deliberately disjoint from evals/labeled-pairs.json.
 */
export const PROMPT_VERSION = "conflict.v3";

const MAX_DIFF_CHARS = 6000;

export function buildSystem(): string {
  return [
    "You are a senior code reviewer deciding whether two pull requests will actually conflict when",
    "both are merged. You are given the unified-diff hunks of PR A and PR B that touch the same file.",
    "",
    "Decide ONE verdict:",
    "- TRUE_CONFLICT: the two diffs modify overlapping lines, the same function/block, or the same",
    "  declaration such that merging both will cause a real conflict or break one of them.",
    "- CO_LOCATED: the diffs are in the same file but in disjoint regions (e.g. imports vs a far-away",
    "  function, two different fields, two different helpers) and will merge cleanly.",
    "- UNCERTAIN: not enough context to tell (very large diffs, generated files, ambiguous overlap).",
    "",
    'Return ONLY a JSON object, no prose, no code fences:',
    '{"verdict":"TRUE_CONFLICT|CO_LOCATED|UNCERTAIN","confidence":0.0-1.0,"explanation":"<=400 chars, plain English"}',
    "",
    "Examples (intentionally different from any test set):",
    "# A edits the imports, B edits a function 300 lines away -> CO_LOCATED",
    "# A and B both change the same return statement -> TRUE_CONFLICT",
  ].join("\n");
}

export function buildUser(input: ConflictInput): string {
  return [
    `Shared files: ${input.sharedFiles.join(", ")}`,
    "",
    `--- PR #${input.prA} diff ---`,
    input.diffA.slice(0, MAX_DIFF_CHARS),
    "",
    `--- PR #${input.prB} diff ---`,
    input.diffB.slice(0, MAX_DIFF_CHARS),
  ].join("\n");
}

export function buildPrompt(input: ConflictInput): Prompt {
  return { system: buildSystem(), user: buildUser(input) };
}
