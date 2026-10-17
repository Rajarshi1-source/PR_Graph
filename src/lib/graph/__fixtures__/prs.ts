import type { PRWithFiles, PRFile } from "../types";

/**
 * Test helpers for building PR fixtures with real unified-diff patches. Lives outside __tests__ so
 * Vitest does not collect it as a suite.
 */

/** One hunk: `@@ -oldStart,oldLen +newStart,newLen @@ context` with the given body lines. */
export function hunk(oldStart: number, body: string[], context = ""): string {
  const oldLen = body.filter((l) => !l.startsWith("+")).length;
  const newLen = body.filter((l) => !l.startsWith("-")).length;
  const start = oldLen === 0 ? oldStart - 1 : oldStart;
  return [`@@ -${start},${oldLen} +${start},${newLen} @@${context ? ` ${context}` : ""}`, ...body].join("\n");
}

/** Replace base line `line` with `text`. */
export const replaceLine = (line: number, text: string, context = "") =>
  hunk(line, [`-old line ${line}`, `+${text}`], context);

/** Insert `text` before base line `line`. */
export const insertBefore = (line: number, text: string, context = "") => hunk(line, [`+${text}`], context);

export function file(filename: string, patch?: string, extra: Partial<PRFile> = {}): PRFile {
  return { filename, additions: 1, deletions: 1, status: "modified", ...(patch !== undefined ? { patch } : {}), ...extra };
}

export function pr(number: number, day: number, files: PRFile[], extra: Partial<PRWithFiles> = {}): PRWithFiles {
  return {
    number,
    title: `PR ${number}`,
    author: `dev${number}`,
    createdAt: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z`,
    htmlUrl: `https://github.com/o/r/pull/${number}`,
    files,
    ...extra,
  };
}
