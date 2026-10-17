/**
 * Regenerable files: overlapping edits here are resolved by regenerating the file on rebase
 * (lockfiles, snapshots, build output), so they never block — they downgrade to TOUCHES. Pure.
 */
export const DEFAULT_REGENERABLE_GLOBS = [
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
  "**/bun.lock",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/Gemfile.lock",
  "**/composer.lock",
  "**/go.sum",
  "**/*.snap",
  "**/__snapshots__/**",
  "dist/**",
  "build/**",
  "**/*.min.js",
  "**/*.generated.*",
];

const cache = new Map<string, RegExp>();

/** Minimal glob → RegExp: `**` (any path, incl. empty), `*` (no slash), `?` (one char). */
export function globToRegExp(glob: string): RegExp {
  const hit = cache.get(glob);
  if (hit) return hit;
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const compiled = new RegExp(`^${re}$`);
  cache.set(glob, compiled);
  return compiled;
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

export function isRegenerable(path: string, extraGlobs: readonly string[] = []): boolean {
  return matchesAny(path, DEFAULT_REGENERABLE_GLOBS) || matchesAny(path, extraGlobs);
}
