/**
 * Line-level lexing for symbol references in diff lines. Pure.
 *
 * Diff hunks start anywhere in a file, so this is best effort: it tracks multi-line comments,
 * docstrings and raw strings across the lines of one hunk, and falls back to a prose detector for
 * text whose opening delimiter is outside the hunk (doc comments, help text, docstrings).
 */
import { extensionOf } from "./languages";

/** Open multi-line construct carried to the next line: its closing delimiter, or null. */
export type LexState = string | null;

const C_LIKE = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "go", "java", "kt", "kts", "scala", "cs", "rs", "php"]);
const BACKTICK = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "go"]);
const HASH = new Set(["py", "rb", "php"]);

export interface Lexer {
  /** Code on this line with strings and comments blanked; updates the carried state. */
  code(line: string): string;
}

export function lexerFor(path: string): Lexer {
  const ext = extensionOf(path);
  const cLike = C_LIKE.has(ext);
  const backtick = BACKTICK.has(ext);
  const hash = HASH.has(ext);
  const py = ext === "py";
  // `'` starts a lifetime or char literal in Rust, not a string.
  const singleQuote = ext !== "rs";
  // Rust strings may span lines (`r"…"`, `"\` continuations); elsewhere an unclosed quote ends at EOL.
  const multiLineDouble = ext === "rs";
  let state: LexState = null;

  return {
    code(line: string): string {
      // A hunk that starts inside a doc comment: `* text` / `*/` continuation lines.
      if (cLike && state === null && /^\s*\*(\s|\/|$)/.test(line)) return "";
      let out = "";
      let i = 0;
      while (i < line.length) {
        if (state !== null) {
          const j = line.indexOf(state, i);
          if (j < 0) return out;
          i = j + state.length;
          state = null;
          out += " ";
          continue;
        }
        const rest = line.slice(i);
        if (cLike && rest.startsWith("/*")) {
          state = "*/";
          i += 2;
          continue;
        }
        if ((cLike && rest.startsWith("//")) || (hash && rest[0] === "#")) return out;
        if (py && (rest.startsWith('"""') || rest.startsWith("'''"))) {
          state = rest.slice(0, 3);
          i += 3;
          continue;
        }
        const ch = line[i];
        if (ch === "`" && backtick) {
          state = "`";
          i++;
          continue;
        }
        if (ch === '"' || (ch === "'" && singleQuote)) {
          let j = i + 1;
          while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
          if (j >= line.length) {
            if (ch === '"' && multiLineDouble) state = '"';
            return out + ch + ch;
          }
          out += ch + ch;
          i = j + 1;
          continue;
        }
        out += ch;
        i++;
      }
      return out;
    },
  };
}

/** English function words: two or more in a mostly-words line marks it as prose, not code. */
const FUNCTION_WORDS = new Set([
  "the", "a", "an", "of", "to", "that", "which", "by", "be", "are", "was", "were", "will", "would",
  "should", "can", "may", "than", "into", "on", "at", "its", "their", "these", "those", "your",
  "you", "we", "our", "there", "has", "have", "been", "any", "each", "such", "only", "also", "but",
]);
const PLAIN_WORD = /^[(`'"]?[A-Za-z][a-z'’-]*[`'")]?[.,;:!?)]*$/;

/**
 * True for natural-language lines: doc comments, help text and docstrings whose opening delimiter
 * is outside the hunk. Code rarely has two English function words among mostly bare words.
 */
export function isProse(line: string): boolean {
  const words = line.trim().split(/\s+/);
  if (words.length < 5) return false;
  const plain = words.filter((w) => PLAIN_WORD.test(w));
  if (plain.length / words.length < 0.6) return false;
  let fn = 0;
  for (const w of plain) if (FUNCTION_WORDS.has(w.toLowerCase().replace(/[^a-z']/g, ""))) fn++;
  return fn >= 2;
}
