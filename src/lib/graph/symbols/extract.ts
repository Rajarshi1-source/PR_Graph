import { parsePatch } from "../patch/parsePatch";
import { definitionPatterns, STOP_WORDS, MIN_SYMBOL_LENGTH } from "./languages";
import { lexerFor, isProse } from "./lexer";
import { compatible, defShape, type DefShape } from "./signature";

/**
 * How a PR changes a definition it touches. Only removed / renamed / signature can break callers;
 * `compatible` is a signature edit existing call sites survive (new optional parameter, widened
 * visibility, reformatting).
 */
export type Reach = "file" | "dir" | "outside-crate";

export type DefChange = "added" | "removed" | "renamed" | "signature" | "compatible";

export interface FileSymbolFacts {
  file: string;
  /** name → change. For renames the key is the OLD name (what other PRs may still call). */
  defs: Map<string, DefChange>;
  /**
   * Where callers that can break live (absent = anywhere): only the same file (private), the same
   * directory (Go unexported), or outside the crate (Rust `pub` narrowed to `pub(crate)`).
   */
  reach: Map<string, Reach>;
  /** Changed definitions that are members (methods, nested items): called via `x.name` / `T::name`. */
  members: Set<string>;
  /** Identifiers referenced in this PR's ADDED code (not comments, strings or prose). */
  refs: Set<string>;
  /** Subset of `refs` that appears at least once unqualified (not after `.`, `::` or `->`). */
  bareRefs: Set<string>;
  /** Subset of `refs` that appears at least once after `.`, `::` or `->` (member access). */
  qualifiedRefs: Set<string>;
}

const IDENT = /[A-Za-z_$][\w$]*/g;
const escapeRe = (s: string) => s.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
// A leading `key:` is a property / field / keyword-argument name, not a reference.
const LEADING_KEY = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:readonly\s+)?[A-Za-z_$][\w$]*\??\s*:(?!:)/;
const MAX_SIGNATURE_LINES = 20;
const IMPORT_LINE = /^\s*(?:import|from|use|using|require(?:_relative)?)\b/;

interface DefLine {
  name: string;
  shape: DefShape;
}

function defAt(lines: string[], k: number, path: string, patterns: RegExp[]): DefLine | null {
  const tag = lines[k][0];
  const body = lines[k].slice(1);
  for (const p of patterns) {
    const m = p.exec(body);
    if (!m || !m[1] || STOP_WORDS.has(m[1])) continue;
    const name = m[1];
    const at = m[0].search(new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$?!])`));
    const nameEnd = m.index + (at < 0 ? m[0].length - name.length : at) + name.length;
    // Multi-line parameter lists: append this side's continuation lines until the parens balance.
    let text = body;
    const balance = (s: string) => (s.match(/\(/g)?.length ?? 0) - (s.match(/\)/g)?.length ?? 0);
    for (let j = k + 1, n = 0; balance(text.slice(nameEnd)) > 0 && j < lines.length && n < MAX_SIGNATURE_LINES; j++) {
      const t = lines[j][0];
      if (t !== tag && t !== " ") continue;
      text += " " + lines[j].slice(1).trim();
      n++;
    }
    return { name, shape: defShape(text, path, name, nameEnd) };
  }
  return null;
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

  // Removed / added definition variants across the whole file (a definition moved between hunks
  // is a signature comparison, not remove + add; overloads are several variants of one name).
  const removed = new Map<string, DefShape[]>();
  const added = new Map<string, DefShape[]>();
  const refs = new Set<string>();
  const bareRefs = new Set<string>();
  const qualifiedRefs = new Set<string>();
  const imported = new Set<string>();

  for (const h of parsed.hunks) {
    const lex = lexerFor(file);
    for (let k = 0; k < h.lines.length; k++) {
      const raw = h.lines[k];
      const tag = raw[0];
      if (tag !== "+" && tag !== "-" && tag !== " ") continue;
      if (tag !== "-") {
        // New-side lines (context + added) drive the comment/string state.
        const code = lex.code(raw.slice(1));
        if (tag === "+" && IMPORT_LINE.test(raw.slice(1))) {
          for (const m of raw.slice(1).matchAll(IDENT)) imported.add(m[0]);
        }
        if (tag === "+" && !isProse(raw.slice(1))) {
          const keyless = code.replace(LEADING_KEY, (s) => " ".repeat(s.length));
          for (const m of keyless.matchAll(IDENT)) {
            const id = m[0];
            if (id.length < MIN_SYMBOL_LENGTH || STOP_WORDS.has(id)) continue;
            refs.add(id);
            const before = keyless.slice(0, m.index).trimEnd();
            if (/(\.|::|->)$/.test(before)) qualifiedRefs.add(id);
            else bareRefs.add(id);
          }
        }
      }
      if (tag === " ") continue;
      const def = defAt(h.lines, k, file, patterns);
      if (!def) continue;
      const into = tag === "-" ? removed : added;
      const variants = into.get(def.name);
      if (variants) variants.push(def.shape);
      else into.set(def.name, [def.shape]);
    }
  }

  const defs = new Map<string, DefChange>();
  const reach = new Map<string, Reach>();
  const members = new Set<string>();
  const removedOnly = [...removed.keys()].filter((n) => !added.has(n));
  const addedOnly = [...added.keys()].filter((n) => !removed.has(n));

  for (const [name, before] of removed) {
    const after = added.get(name);
    if (!after) continue;
    const texts = new Set(after.map((s) => s.text));
    if (before.every((s) => texts.has(s.text))) continue; // moved or touched, not changed
    // Breaking when some old shape has no compatible new shape (overloads count as alternatives).
    const breaking = before.some((b) => !after.some((a) => compatible(b, a, file)));
    defs.set(name, breaking ? "signature" : "compatible");
    // Rust `pub` → `pub(crate)` with nothing else changed only breaks callers in other crates.
    const crateOnly =
      breaking &&
      file.endsWith(".rs") &&
      after.every((a) => a.visibility === 2) &&
      before.every((b) => after.some((a) => compatible(b, a, file, { ignoreVisibility: true })));
    if (crateOnly) reach.set(name, "outside-crate");
  }
  // Pair removed-only with added-only definitions positionally → renames; leftovers are removals.
  removedOnly.forEach((n, i) => defs.set(n, i < addedOnly.length ? "renamed" : "removed"));
  for (const n of addedOnly.slice(removedOnly.length)) defs.set(n, "added");

  for (const [name, shapes] of removed) {
    const r = shapes[0].reach;
    if (r && !reach.has(name)) reach.set(name, r);
    if (shapes.every((s) => s.member)) members.add(name);
    // A private helper replaced by an import of the same name still resolves for its only callers.
    if (r === "file" && !added.has(name) && imported.has(name)) defs.set(name, "compatible");
  }

  // A PR does not "reference" what it defines itself in its added lines.
  for (const n of added.keys()) {
    refs.delete(n);
    bareRefs.delete(n);
    qualifiedRefs.delete(n);
  }

  return { file, defs, reach, members, refs, bareRefs, qualifiedRefs };
}

/** Rust crate root of a path: everything before its `src/` directory. */
export function crateOf(path: string): string {
  const i = path.lastIndexOf("/src/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Directory of a repo path ("" for the root). */
export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
