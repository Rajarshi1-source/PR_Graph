import type { PRWithFiles, SymbolLink, SymbolChange } from "../types";
import { extractFacts, type FileSymbolFacts } from "./extract";

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

  // name → [(pr, file)] for every added reference
  const refIndex = new Map<string, { pr: number; file: string }[]>();
  // pr → names whose definition that PR itself changes (it is already handling them)
  const touchedDefs = new Map<number, Set<string>>();
  for (const [pr, files] of facts) {
    const touched = new Set<string>();
    for (const f of files) {
      for (const name of f.defs.keys()) touched.add(name);
      for (const name of f.refs) {
        const arr = refIndex.get(name);
        if (arr) arr.push({ pr, file: f.file });
        else refIndex.set(name, [{ pr, file: f.file }]);
      }
    }
    touchedDefs.set(pr, touched);
  }

  const links = new Map<string, ImpactLink>();
  for (const [source, files] of facts) {
    for (const f of files) {
      for (const [name, change] of f.defs) {
        if (!BREAKING.has(change)) continue;
        for (const ref of refIndex.get(name) ?? []) {
          if (ref.pr === source) continue;
          if (touchedDefs.get(ref.pr)?.has(name)) continue;
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
