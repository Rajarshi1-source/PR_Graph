/**
 * Unified-diff parsing into BASE-coordinate change regions. Pure.
 *
 * Two PRs branch from (approximately) the same base, so their edits are only comparable in base
 * (`-`) line numbers, file by file. A region is a maximal run of changed base lines:
 *   - '-' lines occupy base lines  → region [first, last]
 *   - '+' lines insert between base lines → a zero-width region [L, L-1] anchored before base line L
 *   - a replacement ('-' run followed by '+' run) is one region covering the deleted lines.
 */

export interface ChangeRegion {
  /** First base line changed (1-based). */
  start: number;
  /** Last base line changed; `end === start - 1` for a pure insertion. */
  end: number;
  removed: string[];
  added: string[];
}

export interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the closing `@@` — git's enclosing-function context (may be empty). */
  context: string;
  lines: string[];
}

export interface ParsedPatch {
  hunks: ParsedHunk[];
  regions: ChangeRegion[];
  /** False when the input had no hunk header (binary, generated, prose, empty). */
  parseable: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parsePatch(patch: string | undefined | null): ParsedPatch {
  if (!patch) return { hunks: [], regions: [], parseable: false };

  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  for (const line of patch.split(/\r?\n/)) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      current = {
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        context: m[5].trim(),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("diff --git ") || line.startsWith("### ")) {
      current = null; // next file section in a concatenated diff
      continue;
    }
    current.lines.push(line);
  }

  const regions: ChangeRegion[] = [];
  for (const h of hunks) regions.push(...hunkRegions(h));
  return { hunks, regions, parseable: hunks.length > 0 };
}

function hunkRegions(h: ParsedHunk): ChangeRegion[] {
  // With a zero-length old range, `oldStart` is the line AFTER which the insertion happens.
  let cursor = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart;
  const out: ChangeRegion[] = [];
  let open: ChangeRegion | null = null;

  const close = () => {
    if (open) out.push(open);
    open = null;
  };

  for (const raw of h.lines) {
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) continue; // stray file headers
    const tag = raw[0];
    const body = raw.slice(1);
    if (tag === "-") {
      if (!open) open = { start: cursor, end: cursor - 1, removed: [], added: [] };
      open.end = cursor;
      open.removed.push(body);
      cursor++;
    } else if (tag === "+") {
      if (!open) open = { start: cursor, end: cursor - 1, removed: [], added: [] };
      open.added.push(body);
    } else {
      // context line (' ' or an empty line inside a hunk)
      close();
      cursor++;
    }
  }
  close();
  return out;
}

/**
 * Split a concatenated multi-file diff into per-file patches. Recognises the `### <file>` sections
 * produced by `buildSharedDiff` and `diff --git a/x b/y` headers; text before any header is
 * attributed to `fallbackFile`.
 */
export function splitMultiFileDiff(text: string, fallbackFile: string): Map<string, string> {
  const out = new Map<string, string>();
  let file = fallbackFile;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.set(file, (out.get(file) ? out.get(file) + "\n" : "") + buf.join("\n"));
    buf = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const section = /^### (.+)$/.exec(line);
    const git = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (section || git) {
      flush();
      file = section ? section[1].trim() : git![2].trim();
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ")) continue;
    buf.push(line);
  }
  flush();
  return out;
}

/** Diff-style preview lines for a region (removed then added), capped. */
export function regionPreview(r: ChangeRegion, max = 6): string[] {
  const lines = [...r.removed.map((l) => `-${l}`), ...r.added.map((l) => `+${l}`)];
  return lines.slice(0, max);
}
