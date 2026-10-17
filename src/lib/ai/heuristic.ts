import type { ConflictInput, ConflictVerdict } from "./types";
import { parsePatch, splitMultiFileDiff } from "@/lib/graph/patch/parsePatch";
import { conflictingRegions } from "@/lib/graph/patch/regions";
import { extractFacts, type FileSymbolFacts } from "@/lib/graph/symbols/extract";

/**
 * Deterministic heuristic fallback (plan §14) — what PRGraph degrades to whenever the AI layer is
 * disabled, over budget or failing. No LLM, no I/O. Reuses the engine's own primitives:
 *   1. per file, in BASE coordinates: overlapping/adjacent change regions → TRUE_CONFLICT
 *   2. cross-file symbol impact: one side removes/renames/re-signatures a definition the other side
 *      newly references → TRUE_CONFLICT (git merges it, the build breaks)
 *   3. parseable but disjoint and no symbol link → CO_LOCATED
 *   4. nothing parseable (binary, generated, prose) → UNCERTAIN
 */
export function heuristicVerdict(input: ConflictInput): ConflictVerdict {
  const fallbackFile = input.sharedFiles[0] ?? "file";
  const filesA = splitMultiFileDiff(input.diffA, fallbackFile);
  const filesB = splitMultiFileDiff(input.diffB, fallbackFile);

  let parseableFiles = 0;
  for (const file of [...new Set([...filesA.keys(), ...filesB.keys()])].sort()) {
    const a = parsePatch(filesA.get(file));
    const b = parsePatch(filesB.get(file));
    if (!a.parseable || !b.parseable) continue;
    parseableFiles++;
    const regions = conflictingRegions(a.regions, b.regions);
    if (regions.length) {
      const r = regions[0];
      const lines = r.baseEnd >= r.baseStart ? `lines ${r.baseStart}–${r.baseEnd}` : `line ${r.baseStart}`;
      return {
        verdict: "TRUE_CONFLICT",
        confidence: 0.85,
        explanation: `Both PRs change overlapping or adjacent base ${lines} of ${file} — git will report a merge conflict.`,
        resolution: `Merge #${input.prA} first, then rebase #${input.prB} and reconcile ${file}.`,
      };
    }
  }

  const symbol = symbolClash(filesA, filesB) ?? symbolClash(filesB, filesA, true);
  if (symbol) {
    const [definer, user] = symbol.swapped ? [input.prB, input.prA] : [input.prA, input.prB];
    return {
      verdict: "TRUE_CONFLICT",
      confidence: 0.7,
      explanation: `#${definer} ${symbol.change === "signature" ? "changes the signature of" : symbol.change === "renamed" ? "renames" : "removes"} \`${symbol.name}\`, which #${user} references — the merge is textually clean but the result will not build.`,
      resolution: `Merge #${definer} first, then update #${user}'s use of \`${symbol.name}\`.`,
    };
  }

  const anyParseable =
    parseableFiles > 0 ||
    [...filesA.values(), ...filesB.values()].some((p) => parsePatch(p).parseable);
  if (!anyParseable) {
    return {
      verdict: "UNCERTAIN",
      confidence: 0.4,
      explanation: "Could not parse diff hunks for one or both PRs; manual review recommended.",
    };
  }

  return {
    verdict: "CO_LOCATED",
    confidence: 0.7,
    explanation: "PRs touch the same files but in disjoint line ranges — probably independently mergeable.",
  };
}

function facts(files: Map<string, string>): FileSymbolFacts[] {
  const out: FileSymbolFacts[] = [];
  for (const [file, patch] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const f = extractFacts(file, patch);
    if (f) out.push(f);
  }
  return out;
}

function symbolClash(
  definerFiles: Map<string, string>,
  userFiles: Map<string, string>,
  swapped = false,
): { name: string; change: string; swapped: boolean } | null {
  const userFacts = facts(userFiles);
  const refs = new Set(userFacts.flatMap((f) => [...f.refs]));
  const userDefs = new Set(userFacts.flatMap((f) => [...f.defs.keys()]));
  for (const f of facts(definerFiles)) {
    for (const [name, change] of f.defs) {
      if (change === "added" || userDefs.has(name)) continue;
      if (refs.has(name)) return { name, change, swapped };
    }
  }
  return null;
}
