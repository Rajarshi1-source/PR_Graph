/**
 * Definition shapes from diff lines: callable parameters, visibility and reach. Pure.
 *
 * Used to decide whether a changed definition can break *another* PR's call site: a widened type,
 * a new optional parameter or a reformatted signature cannot; a removed or newly required
 * parameter, a changed parameter type in a statically typed language, or narrowed visibility can.
 */
import { extensionOf } from "./languages";

export interface DefShape {
  /** Squashed definition text (comments stripped). Identical text = no change. */
  text: string;
  /** Parameters for callables; `null` for non-callables or when the list could not be read. */
  params: string[] | null;
  callable: boolean;
  /** Higher = visible to more code. Only compared within one language. */
  visibility: number;
  /** Where other code can reference it from: same file, same directory (Go package), or anywhere. */
  reach: "file" | "dir" | null;
  /** Indented definition: a member of a class/impl/module rather than a top-level symbol. */
  member: boolean;
  /** TS object-shaped types written on one line (`interface X { a: T }`, `type X = { … }`). */
  fields?: string[];
}

/** Languages whose compiler rejects a call when a parameter's type changes (TS via tsc). */
const TYPED = new Set(["rs", "go", "java", "kt", "kts", "scala", "cs", "php", "ts", "tsx", "mts", "cts"]);
const JVM_CS = new Set(["java", "kt", "kts", "scala", "cs"]);
const TS_JS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]);
const NON_CALLABLE_KEYWORD =
  /\b(class|struct|interface|type|enum|trait|module|record|object|mod|union|alias|alias_method|attr_\w+)\b/;
const VALUE_KEYWORD = /\b(const|let|var|static|val)\b/;
const ARROW =
  /^\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(([^()]*(?:\([^()]*\)[^()]*)*)\)|([A-Za-z_$][\w$]*))\s*(?::\s*[^=]+)?=>/;

export function stripLineComment(line: string, ext: string): string {
  let s = line.replace(/\/\*.*?\*\//g, " ");
  if (ext === "py" || ext === "rb") s = s.replace(/\s#.*$/, "");
  else s = s.replace(/\s\/\/.*$/, "");
  return s;
}

export const squash = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/\s*([(),:<>[\]])\s*/g, "$1")
    .replace(/,\)/g, ")")
    .replace(/\s*\{\s*$/, "")
    .trim();

/** Index just past a balanced `open…close` run starting at `start`, or -1 if unterminated. */
function skipBalanced(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) return i + 1;
  }
  return -1;
}

/** Split on top-level commas. */
export function splitParams(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch) && depth > 0) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((p) => p.length > 0);
}

function visibilityOf(text: string, ext: string, name: string): number {
  if (TS_JS.has(ext)) return /^\s*export\b/.test(text) ? 2 : /\bprivate\b|^\s*#/.test(text) ? 0 : 1;
  if (ext === "rs") return /\bpub\s/.test(text) ? 3 : /\bpub\(/.test(text) ? 2 : 1;
  if (ext === "go") return /^[A-Z]/.test(name) ? 3 : 1;
  if (ext === "kt" || ext === "kts")
    return /\bprivate\b/.test(text) ? 0 : /\binternal\b/.test(text) ? 1 : /\bprotected\b/.test(text) ? 2 : 3;
  if (JVM_CS.has(ext) || ext === "php")
    return /\bpublic\b/.test(text) ? 3 : /\bprotected\b/.test(text) ? 2 : /\bprivate\b/.test(text) ? 0 : 1;
  return 1;
}

function reachOf(text: string, ext: string, name: string): DefShape["reach"] {
  if (ext === "go") return /^[a-z_]/.test(name) ? "dir" : null;
  if (ext === "rs") return /\bpub\b/.test(text) ? null : "file";
  if (JVM_CS.has(ext) || ext === "php" || TS_JS.has(ext)) return /\bprivate\b/.test(text) ? "file" : null;
  return null;
}

/**
 * Shape of the definition of `name` that starts at `nameEnd` in `text` (the definition line, with
 * any continuation lines of a multi-line parameter list already appended).
 */
export function defShape(text: string, path: string, name: string, nameEnd: number): DefShape {
  const ext = extensionOf(path);
  const clean = stripLineComment(text, ext);
  const prefix = clean.slice(0, Math.max(0, nameEnd - name.length));
  let rest = clean.slice(nameEnd);
  const base = {
    text: squash(clean),
    visibility: visibilityOf(clean, ext, name),
    reach: reachOf(prefix, ext, name),
    member:
      ext === "go"
        ? /^\s*func\s*\(/.test(clean)
        : /^\s+/.test(text) && !(TS_JS.has(ext) && /^\s*export\b/.test(clean)),
  };

  if (VALUE_KEYWORD.test(prefix) && !/\bfn\b|\bfunc\b|\bfunction\b|\bfun\b/.test(prefix)) {
    const m = ARROW.exec(rest);
    if (!m) return { ...base, params: null, callable: false };
    return { ...base, callable: true, params: m[2] ? [m[2]] : splitParams(m[1] ?? "") };
  }
  if (NON_CALLABLE_KEYWORD.test(prefix) || /^\s*alias/.test(clean)) {
    return { ...base, params: null, callable: false, fields: TS_JS.has(ext) ? objectFields(rest) : undefined };
  }

  rest = rest.replace(/^\s+/, "");
  if (rest.startsWith("<")) {
    const end = skipBalanced(rest, 0, "<", ">");
    rest = end < 0 ? "" : rest.slice(end).replace(/^\s+/, "");
  }
  if (rest.startsWith("(")) {
    const end = skipBalanced(rest, 0, "(", ")");
    if (end < 0) return { ...base, params: null, callable: true };
    return { ...base, callable: true, params: splitParams(rest.slice(1, end - 1)) };
  }
  if (ext === "rb") {
    // `def name a, b` / `def name; …; end` / `def name`
    const own = rest.split(";")[0].trim();
    return { ...base, callable: true, params: own ? splitParams(own) : [] };
  }
  return { ...base, params: null, callable: false };
}

/** Members of a one-line object type body (`{ a: T; b?: U }`), or undefined for any other shape. */
function objectFields(rest: string): string[] | undefined {
  const body = rest.replace(/^\s*(?:<[^>]*>)?\s*(?:extends\s+[^{]+)?=?\s*/, "");
  if (!body.startsWith("{")) return undefined;
  const end = skipBalanced(body, 0, "{", "}");
  if (end < 0 || body.slice(end).replace(/[;\s]/g, "")) return undefined;
  return splitParams(body.slice(1, end - 1).replace(/;/g, ","));
}

const RECEIVER = /^(?:&\s*(?:'\w+\s+)?(?:mut\s+)?|mut\s+)?self\b|^(?:self|cls|this)\s*(?::|$)/;

function isVariadic(p: string): boolean {
  return /\.\.\./.test(p) || /^\*{1,2}\w/.test(p) || /^params\s/.test(p) || /^&\w/.test(p);
}

function isOptional(p: string, ext: string): boolean {
  if (isVariadic(p)) return true;
  if (/^[\w$]+\?\s*:/.test(p)) return true; // TS `x?: T`
  if (/(^|[^=!<>])=(?![=>])/.test(p)) return true; // default value
  if (ext === "rb" && /^\w+:\s*\S/.test(p)) return true; // Ruby `key: default` (`key:` is required)
  return false;
}

function typeOf(p: string, ext: string): string {
  const noDefault = p.replace(/(^|[^=!<>])=(?![=>]).*$/, "$1").trim();
  if (ext === "go") {
    const parts = noDefault.split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  }
  if (JVM_CS.has(ext) && ext !== "kt" && ext !== "kts" && ext !== "scala") {
    const parts = noDefault
      .replace(/@\w+(\([^)]*\))?/g, "")
      .replace(/\bfinal\b/g, "")
      .trim()
      .split(/\s+/);
    return parts.slice(0, -1).join(" ");
  }
  if (ext === "php") return noDefault.replace(/&?\.{0,3}\$\w+$/, "").trim();
  const colon = noDefault.indexOf(":");
  return colon < 0 ? "" : noDefault.slice(colon + 1).replace(/\s+/g, "");
}

/** A value of the old object type still satisfies the new one: no removed, retyped or new required field. */
function fieldsCompatible(before: string[], after: string[]): boolean {
  const parse = (f: string) => {
    const m = /^(?:readonly\s+)?([\w$]+)(\?)?\s*:\s*(.+)$/.exec(f.trim());
    return m ? { name: m[1], optional: !!m[2], type: m[3] } : null;
  };
  const old = new Map(
    before
      .map(parse)
      .filter((x) => x !== null)
      .map((x) => [x.name, x]),
  );
  for (const f of after.map(parse)) {
    if (!f) continue;
    const prev = old.get(f.name);
    if (!prev) {
      if (!f.optional) return false;
      continue;
    }
    if (!typeAccepts(prev.type, f.type)) return false;
    old.delete(f.name);
  }
  return old.size === 0;
}

/** Does a parameter now typed `after` still accept arguments written for `before`? */
function typeAccepts(before: string, after: string): boolean {
  const a = before.replace(/\s+/g, "");
  const b = after.replace(/\s+/g, "");
  if (!a || !b || a === b) return true;
  if (b === "any" || b === "unknown" || b === "Object" || b === "interface{}" || b === "any?") return true;
  // Widened to a union that still contains the old type: `number` → `number | string`.
  return splitTop(b, "|").includes(a);
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch) && depth > 0) depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.filter(Boolean);
}

/**
 * Can every call written against `before` still compile/run against `after`? Conservative toward
 * "yes" when a side is unreadable: SEMANTIC edges block, so an unknown shape must not create one.
 */
export function compatible(
  before: DefShape,
  after: DefShape,
  path: string,
  { ignoreVisibility = false } = {},
): boolean {
  if (!ignoreVisibility && after.visibility < before.visibility) return false;
  if (before.fields && after.fields) return fieldsCompatible(before.fields, after.fields);
  if (!before.callable || !after.callable || before.params === null || after.params === null) return true;
  const ext = extensionOf(path);
  const strip = (ps: string[]) => ps.filter((p) => !RECEIVER.test(p) && p !== "*" && p !== "/");
  const o = strip(before.params);
  const n = strip(after.params);
  const required = (ps: string[]) => ps.filter((p) => !isOptional(p, ext)).length;
  if (required(n) > required(o)) return false;
  if (n.length < o.length && !n.some(isVariadic)) return false;
  if (TYPED.has(ext)) {
    for (let i = 0; i < Math.min(o.length, n.length); i++) {
      if (isVariadic(n[i])) break; // a rest parameter absorbs the remaining arguments
      if (!typeAccepts(typeOf(o[i], ext), typeOf(n[i], ext))) return false;
    }
  }
  return true;
}
