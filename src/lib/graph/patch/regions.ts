import type { ChangeRegion } from "./parsePatch";
import { regionPreview } from "./parsePatch";
import type { ConflictRegion } from "../types";

/**
 * git's merge rule in base coordinates: two change regions conflict when they overlap OR touch
 * (no unchanged base line between them) — unless both sides made the identical change, which
 * merges cleanly. Two insertions conflict only at the same point.
 * Pure; `end < start` marks an insertion point before base line `start`.
 */
export function regionsConflict(a: ChangeRegion, b: ChangeRegion): boolean {
  if (!(a.start <= b.end + 1 && b.start <= a.end + 1)) return false;
  return !identical(a, b);
}

function identical(a: ChangeRegion, b: ChangeRegion): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.added.length === b.added.length &&
    a.added.every((l, i) => l === b.added[i])
  );
}

/**
 * Compare the regions of two PRs in one file. Returns the conflicting stretches (merged per
 * overlapping pair, sorted by base line) — empty when the edits are disjoint.
 */
export function conflictingRegions(a: ChangeRegion[], b: ChangeRegion[]): ConflictRegion[] {
  const out: ConflictRegion[] = [];
  for (const ra of a) {
    for (const rb of b) {
      if (!regionsConflict(ra, rb)) continue;
      out.push({
        baseStart: Math.min(ra.start, rb.start),
        baseEnd: Math.max(ra.end, rb.end, Math.min(ra.start, rb.start) - 1),
        aPreview: regionPreview(ra),
        bPreview: regionPreview(rb),
      });
    }
  }
  return out.sort((x, y) => x.baseStart - y.baseStart || x.baseEnd - y.baseEnd);
}

/** The first region of each side, for TOUCHES edges (shows where both PRs edit, disjointly). */
export function nearestRegions(a: ChangeRegion[], b: ChangeRegion[]): ConflictRegion[] {
  if (!a.length || !b.length) return [];
  let best: [ChangeRegion, ChangeRegion] = [a[0], b[0]];
  let bestGap = Infinity;
  for (const ra of a)
    for (const rb of b) {
      const gap = Math.max(ra.start, rb.start) - Math.min(Math.max(ra.end, ra.start), Math.max(rb.end, rb.start));
      if (gap < bestGap) {
        bestGap = gap;
        best = [ra, rb];
      }
    }
  const [ra, rb] = best;
  return [
    {
      baseStart: Math.min(ra.start, rb.start),
      baseEnd: Math.max(ra.end, rb.end, Math.min(ra.start, rb.start) - 1),
      aPreview: regionPreview(ra),
      bPreview: regionPreview(rb),
    },
  ];
}
