import { describe, it, expect } from "vitest";
import { impactLinks } from "../symbols/impact";
import { extractFacts } from "../symbols/extract";
import { isProse, lexerFor } from "../symbols/lexer";
import type { PRWithFiles } from "../types";

const pr = (number: number, files: Record<string, string[]>): PRWithFiles => ({
  number,
  title: `PR ${number}`,
  author: "t",
  createdAt: `2026-01-0${number}T00:00:00Z`,
  htmlUrl: "",
  files: Object.entries(files).map(([filename, lines]) => ({
    filename,
    patch: `@@ -10,${lines.length} +10,${lines.length} @@\n${lines.join("\n")}`,
    additions: 1,
    deletions: 1,
    status: "modified",
  })),
});
/** Names A → B links on, or [] when the pair is independent. */
const linked = (a: Record<string, string[]>, b: Record<string, string[]>) =>
  impactLinks([pr(1, a), pr(2, b)]).flatMap((l) => l.symbols.map((s) => `${l.source}->${l.target} ${s.change} ${s.name}`));

describe("signature compatibility", () => {
  it("a new optional / defaulted / variadic parameter does not break callers", () => {
    const call = { "src/b.ts": ["+  formatPrice(total);"] };
    expect(linked({ "src/a.ts": ["-export function formatPrice(c: number) {", "+export function formatPrice(c: number, cur?: string) {"] }, call)).toEqual([]);
    expect(linked({ "src/a.ts": ["-export function formatPrice(c: number) {", "+export function formatPrice(c: number, cur = 'USD') {"] }, call)).toEqual([]);
    const goCall = { "cmd/b.go": ["+\tc.InitCmd()"] };
    expect(linked({ "a.go": ["-func (c *Command) InitCmd() {", "+func (c *Command) InitCmd(args ...string) {"] }, goCall)).toEqual([]);
    const rbCall = { "lib/b.rb": ["+    QueryParser.make_default(0)"] };
    expect(linked({ "lib/a.rb": ["-    def self.make_default(limit)", "+    def self.make_default(limit, **options)"] }, rbCall)).toEqual([]);
  });

  it("a new required parameter or a removed one does", () => {
    expect(linked({ "billing/a.py": ["-def render(order):", "+def render(order, locale):"] }, { "billing/b.py": ["+    render(order)"] })).toEqual(["1->2 signature render"]);
    expect(linked({ "lib/a.rb": ["-    def normalize(params, name, v)", "+    def normalize(params, name, v, depth)"] }, { "lib/b.rb": ["+      @parser.normalize(params, name, data)"] })).toEqual(["1->2 signature normalize"]);
  });

  it("compares parameter types in typed languages, allowing widening to a union", () => {
    const call = { "src/b.ts": ["+  const s = formatPrice(subtotal);"] };
    expect(linked({ "src/a.ts": ["-export function formatPrice(c: number) {", "+export function formatPrice(c: Money) {"] }, call)).toEqual(["1->2 signature formatPrice"]);
    expect(linked({ "src/a.ts": ["-export function formatPrice(c: number) {", "+export function formatPrice(c: number | bigint) {"] }, call)).toEqual([]);
    expect(linked({ "src/a.rs": ["-pub fn files(args: Args) -> bool {", "+pub fn files(args: &Args) -> bool {"] }, { "src/b.rs": ["+    files(args);"] })).toEqual(["1->2 signature files"]);
  });

  it("reads multi-line parameter lists and ignores return-type / comment-only edits", () => {
    expect(
      linked(
        { "flask/a.py": ["-    def route(", "-        self, rule: str, **options: t.Any", "-    ) -> t.Callable:", "+    def route(self, rule: str, **options: t.Any) -> t.Callable[[T], T]:"] },
        { "app/b.py": ["+@app.route('/')"] },
      ),
    ).toEqual([]);
    expect(linked({ "a.py": ["-    def name(self) -> str:  # type: ignore", "+    def name(self) -> str:"] }, { "b.py": ["+    x = obj.name()"] })).toEqual([]);
  });

  it("type, class and constant definitions only break when removed, renamed or narrowed", () => {
    const use = { "src/b.ts": ["+import type { SearchParams } from './a';"] };
    expect(linked({ "src/a.ts": ["-export type SearchParams = Record<string, string>;", "+export type SearchParams = Record<string, string | undefined>;"] }, use)).toEqual([]);
    expect(linked({ "src/a.ts": ["-export class HTTPError extends Error {", "+declare class HTTPError extends Error {"] }, { "src/b.ts": ["+import { HTTPError } from '.';"] })).toEqual([
      "1->2 signature HTTPError",
    ]);
  });

  it("one-line object types break on removed, retyped or newly required fields only", () => {
    const use = { "src/b.ts": ["+const o: Opts = { id: 1 };"] };
    const change = (after: string) => ({ "src/a.ts": ["-export interface Opts { id: number }", `+export interface Opts ${after}`] });
    expect(linked(change("{ id: string }"), use)).toEqual(["1->2 signature Opts"]);
    expect(linked(change("{ id: number; tag: string }"), use)).toEqual(["1->2 signature Opts"]);
    expect(linked(change("{ id: number; tag?: string }"), use)).toEqual([]);
    expect(linked(change("{ id: number | bigint }"), use)).toEqual([]);
  });

  it("any overload compatible with the old shape keeps callers working", () => {
    expect(
      linked(
        { "src/a.ts": ["-export function useThing(key: Key, fn: Fn, config: Config) {", "+export function useThing(key: Key): R", "+export function useThing(...args: any[]) {"] },
        { "src/b.ts": ["+  const r = useThing(k, f, c);"] },
      ),
    ).toEqual([]);
  });
});

describe("reach", () => {
  it("private definitions only affect callers in the same file", () => {
    const a = { "src/A.java": ["-  private static int toInt(long x) {"] };
    expect(linked(a, { "src/B.java": ["+    return toInt(v);"] })).toEqual([]);
    expect(linked(a, { "src/A.java": ["+    return toInt(v);"] })).toEqual(["1->2 removed toInt"]);
  });

  it("a private helper replaced by an import of the same name is not a removal", () => {
    expect(
      linked({ "src/A.java": ["+import static java.lang.Math.toIntExact;", "-  private static int toIntExact(long x) {"] }, { "src/A.java": ["+    return toIntExact(v);"] }),
    ).toEqual([]);
  });

  it("Go unexported functions are reachable only unqualified from the same package directory", () => {
    const a = { "cmd/helpers.go": ["-func names(cs []*Command) []string {"] };
    expect(linked(a, { "cmd/init.go": ["+\tn := names(cmds)"] })).toEqual(["1->2 removed names"]);
    expect(linked(a, { "other/x.go": ["+\tn := names(cmds)"] })).toEqual([]);
    expect(linked(a, { "cmd/init.go": ["+\tn := p.names()"] })).toEqual([]);
  });

  it("Rust pub → pub(crate) only breaks other crates", () => {
    const a = { "crates/regex/src/strip.rs": ["-pub fn strip_from_match(e: Hir) -> Hir {", "+pub(crate) fn strip_from_match(e: Hir) -> Hir {"] };
    expect(linked(a, { "crates/regex/src/config.rs": ["+    strip::strip_from_match(e);"] })).toEqual([]);
    expect(linked(a, { "crates/core/src/main.rs": ["+    grep_regex::strip_from_match(e);"] })).toEqual(["1->2 signature strip_from_match"]);
  });

  it("members are reached through `x.name`; a bare homonym in another file is not a use", () => {
    const a = { "src/dir.rs": ["-    pub fn path(&self) -> &Path {", "+    pub fn path(&self, full: bool) -> &Path {"] };
    expect(linked(a, { "src/printer.rs": ["+    let path = format!(\"{}\", p);"] })).toEqual([]);
    expect(linked(a, { "src/printer.rs": ["+    let p = dent.path();"] })).toEqual(["1->2 signature path"]);
  });

  it("a method moved to another file of the same PR (e.g. a base class) is not removed", () => {
    expect(
      linked(
        { "flask/blueprints.py": ["-    def endpoint(self, endpoint):"], "flask/scaffold.py": ["+    def endpoint(self, endpoint):"] },
        { "flask/app.py": ["+        bp.endpoint('x')"] },
      ),
    ).toEqual([]);
  });
});

describe("references", () => {
  it("ignores doc comments, docstrings, raw strings and prose", () => {
    const a = { "src/A.java": ["-  public GsonBuilder factory(Factory f) {", "+  public GsonBuilder registerFactory(Factory f) {"] };
    expect(linked(a, { "src/B.java": ["+ * This class is a type adapter factory; excluded types"] })).toEqual([]);
    expect(linked(a, { "src/B.java": ["+    builder.factory(f);"] })).toEqual(["1->2 renamed factory"]);

    const py = { "requests/models.py": ["-    def send(self, session):"] };
    expect(linked(py, { "requests/api.py": ['+    """', "+    :param timeout: How many seconds to wait for the server to send data", '+    """'] })).toEqual([]);

    const go = { "command.go": ["-func (c *Command) Help() error {"] };
    expect(linked(go, { "commander.go": ["+\tLong: `Help provides help for any command", "+Simply type Help and more."] })).toEqual([]);
  });

  it("a leading `key:` is a property name, not a reference", () => {
    const facts = extractFacts("src/x.rs", "@@ -1,1 +1,1 @@\n+    pub(crate) multi_line: bool,");
    expect(facts!.refs.has("multi_line")).toBe(false);
  });

  it("lexer tracks block comments and strings across lines", () => {
    const lex = lexerFor("a.ts");
    expect(lex.code("const x = 1; /* start")).toBe("const x = 1; ");
    expect(lex.code("still comment loadUser()")).toBe("");
    expect(lex.code("end */ loadUser(x)").trim()).toBe("loadUser(x)");
    expect(lexerFor("a.py").code('x = "loadUser" # loadUser')).toBe('x = "" ');
  });

  it("detects English prose but not code", () => {
    expect(isProse("of printing the file path as a prefix for each matched line.")).toBe(true);
    expect(isProse("return value if value is not None else default")).toBe(false);
    expect(isProse("const user = await loadUser(id);")).toBe(false);
  });
});
