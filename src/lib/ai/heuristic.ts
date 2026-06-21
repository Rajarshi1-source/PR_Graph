import type { ConflictInput, ConflictVerdict } from "./types";

/**
 * Deterministic heuristic fallback (plan §14). No LLM, no I/O — parses unified-diff hunk headers
 * and compares the changed line ranges:
 *   - overlapping ranges in a shared file  → TRUE_CONFLICT
 *   - same file but disjoint ranges        → CO_LOCATED
 *   - nothing parseable                    → UNCERTAIN
 * This is what PRGraph degrades to whenever the AI layer is disabled or fails.
 */
interface Range {
  start: number;
  end: number;
}

const HUNK = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;

function parseRanges(diff: string): Range[] {
  const ranges: Range[] = [];
  let m: RegExpExecArray | null;
  HUNK.lastIndex = 0;
  while ((m = HUNK.exec(diff)) !== null) {
    const start = Number(m[1]);
    const len = m[2] ? Number(m[2]) : 1;
    ranges.push({ start, end: start + Math.max(len, 1) - 1 });
  }
  return ranges;
}

function overlaps(a: Range, b: Range): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export function heuristicVerdict(input: ConflictInput): ConflictVerdict {
  const a = parseRanges(input.diffA);
  const b = parseRanges(input.diffB);

  if (a.length === 0 || b.length === 0) {
    return {
      verdict: "UNCERTAIN",
      confidence: 0.4,
      explanation: "Could not parse diff hunks for one or both PRs; manual review recommended.",
    };
  }

  const collision = a.some((ra) => b.some((rb) => overlaps(ra, rb)));
  if (collision) {
    return {
      verdict: "TRUE_CONFLICT",
      confidence: 0.8,
      explanation: "Both PRs modify overlapping line ranges in shared files — likely a real conflict.",
    };
  }

  return {
    verdict: "CO_LOCATED",
    confidence: 0.7,
    explanation: "PRs touch the same files but in disjoint line ranges — probably independently mergeable.",
  };
}
