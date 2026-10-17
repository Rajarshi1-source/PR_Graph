import { parsePatch } from "../patch/parsePatch";
import {
  definitionPatterns,
  usesHashComments,
  STOP_WORDS,
  MIN_SYMBOL_LENGTH,
} from "./languages";

/** How a PR changes a definition it touches. Only removed/renamed/signature can break callers. */
export type DefChange = "added" | "removed" | "renamed" | "signature";

export interface FileSymbolFacts {
  file: string;
  /** name → change. For renames the key is the OLD name (what other PRs may still call). */
  defs: Map<string, DefChange>;
  /** Identifiers referenced in this PR's ADDED lines (excluding names it defines there). */
  refs: Set<string>;
}

const IDENT = /[A-Za-z_$][\w$]*/g;

function defName(line: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = p.exec(line);
    if (m && m[1] && !STOP_WORDS.has(m[1])) return m[1];
  }
  return null;
}

const squash = (s: string) => s.replace(/\s+/g, " ").replace(/\s*\{\s*$/, "").trim();

/** Strip string literals and line comments so identifiers inside them are not "references". */
function codeOnly(line: string, hashComments: boolean): string {
  let s = line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
  s = s.replace(/\/\/.*$/, "");
  if (hashComments) s = s.replace(/#.*$/, "");
  return s;
}

/**
 * Extract definition changes + added references from one file's patch. Pure and deterministic.
 * Returns null for languages we have no patterns for (no SEMANTIC edges from those files).
 */
export function extractFacts(file: string, patch: string | undefined): FileSymbolFacts | null {
  const patterns = definitionPatterns(file);
  if (!patterns || !patch) return null;
  const parsed = parsePatch(patch);
  if (!parsed.parseable) return null;
  const hash = usesHashComments(file);

  // Collect removed/added definition lines across the whole file (a def moved between hunks is a
  // signature comparison, not remove+add).
  const removed = new Map<string, string>();
  const added = new Map<string, string>();
  const removedOrder: string[] = [];
  const addedOrder: string[] = [];
  const refs = new Set<string>();

  for (const h of parsed.hunks) {
    for (const raw of h.lines) {
      const tag = raw[0];
      if (tag !== "+" && tag !== "-") continue;
      const body = raw.slice(1);
      const name = defName(body, patterns);
      if (tag === "-") {
        if (name && !removed.has(name)) {
          removed.set(name, squash(body));
          removedOrder.push(name);
        }
      } else {
        if (name && !added.has(name)) {
          added.set(name, squash(body));
          addedOrder.push(name);
        }
        for (const id of codeOnly(body, hash).match(IDENT) ?? []) {
          if (id.length >= MIN_SYMBOL_LENGTH && !STOP_WORDS.has(id)) refs.add(id);
        }
      }
    }
  }

  const defs = new Map<string, DefChange>();
  const removedOnly = removedOrder.filter((n) => !added.has(n));
  const addedOnly = addedOrder.filter((n) => !removed.has(n));

  for (const n of removedOrder) {
    if (added.has(n) && added.get(n) !== removed.get(n)) defs.set(n, "signature");
  }
  // Pair removed-only with added-only definitions positionally → renames; leftovers are removals.
  removedOnly.forEach((n, i) => defs.set(n, i < addedOnly.length ? "renamed" : "removed"));
  for (const n of addedOnly.slice(removedOnly.length)) defs.set(n, "added");

  // A PR does not "reference" what it defines itself in its added lines.
  for (const n of added.keys()) refs.delete(n);

  return { file, defs, refs };
}
