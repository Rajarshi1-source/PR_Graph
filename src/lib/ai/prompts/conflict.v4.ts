import type { ConflictInput } from "../types";
import type { Prompt } from "../adapters/types";

/**
 * conflict.v4 — adds (1) the deterministic engine's findings as a FOCUS section (conflicting base
 * regions, cross-file symbol links) so the model reasons about what the engine already found, and
 * (2) a `resolution` field with a concrete suggested fix. Few-shots stay disjoint from the eval sets.
 */
export const PROMPT_VERSION = "conflict.v4";

const MAX_DIFF_CHARS = 6000;
const MAX_FOCUS_CHARS = 1500;

export function buildSystem(): string {
  return [
    "You are a senior code reviewer deciding whether two open pull requests will actually conflict",
    "when both are merged into the same base branch. You get the unified-diff hunks of PR A and PR B",
    "for the files they share, plus FOCUS notes from a deterministic analyzer (conflicting base-line",
    "regions, or a symbol one PR changes that the other PR uses — possibly in a different file).",
    "",
    "Decide ONE verdict:",
    "- TRUE_CONFLICT: merging both causes a textual conflict OR leaves code that no longer builds or",
    "  behaves as either author intended (same lines/function/declaration, renamed or re-signatured",
    "  symbol still used by the other PR).",
    "- CO_LOCATED: same file(s) but independent changes that merge cleanly and stay correct.",
    "- UNCERTAIN: not enough context (huge/generated/binary diffs, ambiguous intent).",
    "",
    "Return ONLY a JSON object, no prose, no code fences:",
    '{"verdict":"TRUE_CONFLICT|CO_LOCATED|UNCERTAIN","confidence":0.0-1.0,',
    '"explanation":"<=400 chars, plain English, name the file/symbol",',
    '"resolution":"<=400 chars: which PR to merge first and what the other must change"}',
    "",
    "Examples (intentionally different from any test set):",
    "# A adds a field to a config object at the top, B rewrites a loop 200 lines below -> CO_LOCATED",
    "# A changes parseDate(s) to parseDate(s, tz); B adds a new call parseDate(x) elsewhere -> TRUE_CONFLICT",
  ].join("\n");
}

export function buildUser(input: ConflictInput): string {
  return [
    `Shared files: ${input.sharedFiles.join(", ") || "(none — cross-file symbol link)"}`,
    input.focus ? `\nFOCUS:\n${input.focus.slice(0, MAX_FOCUS_CHARS)}` : "",
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
