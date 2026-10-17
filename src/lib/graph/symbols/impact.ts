import type { PRWithFiles, SymbolLink, SymbolChange } from "../types";
import { crateOf, dirOf, extractFacts, type FileSymbolFacts } from "./extract";
import { extensionOf } from "./languages";

export interface ImpactLink {
  /** PR that removes / renames / changes the signature of a definition. */
  source: number;
  /** PR whose added lines reference that definition. */
  target: number;
  symbols: SymbolLink[];
}

const BREAKING: ReadonlySet<string> = new Set<SymbolChange>(["removed", "renamed", "signature"]);
const MAX_SYMBOLS_PER_LINK = 10;

export function symbolFacts(pr: PRWithFiles): FileSymbolFacts[] {
  const out: FileSymbolFacts[] = [];
  for (const f of pr.files) {
    const facts = extractFacts(f.filename, f.patch);
    if (facts) out.push(facts);
  }
  return out;
}

/**
 * Cross-file symbol impact: A breaks a definition (removed / renamed / signature) that B newly
 * references → link A → B. Git merges such pairs cleanly and the build breaks afterwards, which no
 * file-overlap tool catches. Pure; output sorted by (source, target).
 */
export function impactLinks(prs: PRWithFiles[]): ImpactLink[] {
  const facts = new Map<number, FileSymbolFacts[]>(prs.map((p) => [p.number, symbolFacts(p)]));

  // name → [(pr, file, bare)] for every added reference
  const refIndex = new Map<string, { pr: number; file: string; bare: boolean; qualified: boolean }[]>();
  // pr → names whose definition that PR itself changes (it is already handling them)
  const touchedDefs = new Map<number, Set<string>>();
  // pr → name → files where that PR adds (or keeps changing) a definition of the name
  const definedIn = new Map<number, Map<string, string[]>>();
  for (const [pr, files] of facts) {
    const touched = new Set<string>();
    const defined = new Map<string, string[]>();
    for (const f of files) {
      for (const [name, change] of f.defs) {
        touched.add(name);
        if (change === "added" || change === "compatible" || change === "signature") {
          defined.set(name, [...(defined.get(name) ?? []), f.file]);
        }
      }
      for (const name of f.refs) {
        const entry = { pr, file: f.file, bare: f.bareRefs.has(name), qualified: f.qualifiedRefs.has(name) };
        const arr = refIndex.get(name);
        if (arr) arr.push(entry);
        else refIndex.set(name, [entry]);
      }
    }
    touchedDefs.set(pr, touched);
    definedIn.set(pr, defined);
  }

  const links = new Map<string, ImpactLink>();
  for (const [source, files] of facts) {
    for (const f of files) {
      for (const [name, change] of f.defs) {
        if (!BREAKING.has(change)) continue;
        if (movedWithinScope(f, name, definedIn.get(source)?.get(name) ?? [])) continue;
        const reach = f.reach.get(name);
        for (const ref of refIndex.get(name) ?? []) {
          if (ref.pr === source) continue;
          if (touchedDefs.get(ref.pr)?.has(name)) continue;
          // Private / package-private definitions are unreachable from elsewhere.
          if (reach === "file" && ref.file !== f.file) continue;
          if (reach === "dir" && (dirOf(ref.file) !== dirOf(f.file) || !ref.bare)) continue;
          if (reach === "outside-crate" && crateOf(ref.file) === crateOf(f.file)) continue;
          // Members are reached through `x.name` / `T::name`; a bare name elsewhere is a homonym.
          if (f.members.has(name) && !ref.qualified && ref.file !== f.file) continue;
          const key = `${source}->${ref.pr}`;
          const link = links.get(key) ?? { source, target: ref.pr, symbols: [] };
          if (
            link.symbols.length < MAX_SYMBOLS_PER_LINK &&
            !link.symbols.some((s) => s.name === name && s.refFile === ref.file)
          ) {
            link.symbols.push({
              name,
              change: change as SymbolChange,
              defFile: f.file,
              refFile: ref.file,
            });
          }
          links.set(key, link);
        }
      }
    }
  }

  return [...links.values()]
    .map((l) => ({
      ...l,
      symbols: l.symbols.sort(
        (a, b) => a.name.localeCompare(b.name) || a.refFile.localeCompare(b.refFile),
      ),
    }))
    .sort((a, b) => a.source - b.source || a.target - b.target);
}

/**
 * A removed definition that the same PR re-adds in another file is a move. Members (methods)
 * moved to a base class or sibling file keep working for callers; so does any Go symbol moved
 * within its package directory. Top-level symbols moved between modules still break imports.
 */
function movedWithinScope(f: FileSymbolFacts, name: string, definedFiles: string[]): boolean {
  const elsewhere = definedFiles.filter((d) => d !== f.file);
  if (elsewhere.length === 0) return false;
  if (f.members.has(name)) return true;
  return extensionOf(f.file) === "go" && elsewhere.some((d) => dirOf(d) === dirOf(f.file));
}
