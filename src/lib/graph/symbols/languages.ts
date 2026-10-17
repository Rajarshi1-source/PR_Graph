/**
 * Definition patterns per language (capture group 1 = the defined symbol name). Regex-based on
 * purpose: it runs on diff lines (not whole files), must be deterministic and dependency-free, and
 * its output is `certainty: "approx"` — the AI layer may demote false positives. Pure data.
 */

const ID = "([A-Za-z_$][\\w$]*)";

const TS_JS: RegExp[] = [
  new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${ID}`),
  new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+${ID}`),
  new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const\\s+)?(?:interface|type|enum)\\s+${ID}`),
  new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${ID}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::\\s*[^=]+)?=>`),
  new RegExp(`^\\s*export\\s+(?:const|let|var)\\s+${ID}`),
  // class members: `foo(a, b) {`, `async foo() {`, `public static foo(): T {`
  new RegExp(`^\\s*(?:(?:public|private|protected|static|readonly|async|override|get|set)\\s+)*${ID}\\s*\\([^)]*\\)\\s*(?::\\s*[^{=]+)?\\{\\s*$`),
];

const PY: RegExp[] = [
  new RegExp(`^\\s*(?:async\\s+)?def\\s+${ID}`),
  new RegExp(`^\\s*class\\s+${ID}`),
];

const GO: RegExp[] = [
  new RegExp(`^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${ID}`),
  new RegExp(`^\\s*type\\s+${ID}`),
];

const JVM_CS: RegExp[] = [
  new RegExp(`^\\s*(?:(?:public|private|protected|internal|static|final|abstract|override|open|sealed|data|suspend|virtual|async|partial)\\s+)*(?:class|interface|enum|record|struct|object)\\s+${ID}`),
  new RegExp(`^\\s*(?:(?:public|private|protected|internal|static|final|abstract|override|open|suspend)\\s+)*fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.]+\\.)?${ID}`),
  new RegExp(`^\\s*(?:(?:public|private|protected|internal|static|final|abstract|override|virtual|async|synchronized)\\s+)+[\\w<>\\[\\],.?\\s]*?\\s${ID}\\s*\\(`),
];

const RUST: RegExp[] = [
  new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:fn|struct|enum|trait|type|const|static|mod)\\s+${ID}`),
];

const RUBY: RegExp[] = [
  /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/,
  /^\s*(?:class|module)\s+([A-Z]\w*)/,
];

const PHP: RegExp[] = [
  new RegExp(`^\\s*(?:(?:public|private|protected|static|final|abstract)\\s+)*function\\s+${ID}`),
  new RegExp(`^\\s*(?:(?:abstract|final)\\s+)?(?:class|interface|trait|enum)\\s+${ID}`),
];

const BY_EXT: Record<string, RegExp[]> = {
  ts: TS_JS, tsx: TS_JS, js: TS_JS, jsx: TS_JS, mjs: TS_JS, cjs: TS_JS, mts: TS_JS, cts: TS_JS,
  py: PY,
  go: GO,
  java: JVM_CS, kt: JVM_CS, kts: JVM_CS, scala: JVM_CS, cs: JVM_CS,
  rs: RUST,
  rb: RUBY,
  php: PHP,
};

/** Line-comment prefixes per extension, stripped before collecting references. */
const HASH_COMMENT = new Set(["py", "rb"]);

export function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i + 1).toLowerCase();
}

export function definitionPatterns(path: string): RegExp[] | null {
  return BY_EXT[extensionOf(path)] ?? null;
}

export function usesHashComments(path: string): boolean {
  return HASH_COMMENT.has(extensionOf(path));
}

/** Keywords / ubiquitous names that must never become symbol links. */
export const STOP_WORDS = new Set([
  // JS/TS
  "abstract", "async", "await", "boolean", "break", "case", "catch", "class", "const", "constructor",
  "continue", "debugger", "default", "delete", "else", "enum", "export", "extends", "false", "finally",
  "for", "from", "function", "get", "if", "implements", "import", "in", "instanceof", "interface",
  "let", "new", "null", "number", "object", "of", "private", "protected", "public", "readonly",
  "return", "set", "static", "string", "super", "switch", "symbol", "this", "throw", "true", "try",
  "type", "typeof", "undefined", "unknown", "var", "void", "while", "with", "yield", "any", "never",
  "declare", "namespace", "module", "require", "keyof", "infer", "satisfies", "as", "is",
  // common globals / members
  "console", "log", "error", "warn", "info", "debug", "Promise", "Array", "Object", "String",
  "Number", "Boolean", "Map", "Set", "Date", "Error", "JSON", "Math", "length", "push", "then",
  "map", "filter", "reduce", "forEach", "find", "includes", "toString", "props", "state", "data",
  "value", "key", "id", "index", "item", "items", "result", "res", "req", "err", "ctx", "args",
  "test", "describe", "expect", "toBe", "main", "init", "self", "cls", "None", "True", "False",
  // Python / Go / Ruby / Rust / JVM / PHP keywords
  "def", "elif", "except", "lambda", "pass", "raise", "nonlocal", "global", "assert", "and", "not",
  "or", "func", "package", "struct", "chan", "defer", "go", "range", "select", "map", "nil", "end",
  "begin", "rescue", "ensure", "unless", "elsif", "puts", "fn", "impl", "pub", "mut", "match",
  "loop", "trait", "crate", "use", "where", "Self", "final", "override", "fun", "val", "object",
  "when", "void", "int", "long", "float", "double", "char", "byte", "short", "throws", "echo",
  "array", "isset", "empty",
]);

export const MIN_SYMBOL_LENGTH = 3;
