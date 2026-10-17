import type { PRWithFiles } from "./types";

/**
 * Stacked PRs: B targets A's head branch, so B cannot merge before A. Returns [parent, child]
 * PR-number pairs sorted by (parent, child). Pure.
 */
export function stackLinks(prs: PRWithFiles[]): [number, number][] {
  const byHead = new Map<string, number[]>();
  for (const p of prs) {
    if (!p.headRef) continue;
    const arr = byHead.get(p.headRef);
    if (arr) arr.push(p.number);
    else byHead.set(p.headRef, [p.number]);
  }
  const out: [number, number][] = [];
  for (const child of prs) {
    if (!child.baseRef) continue;
    for (const parent of byHead.get(child.baseRef) ?? []) {
      if (parent !== child.number) out.push([parent, child.number]);
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
