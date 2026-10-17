import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_DIFF_BYTES = 1_000_000;

/** `git diff <base>...HEAD` in `cwd` (the change you are about to open as a PR). */
export async function diffAgainst(base: string, cwd = process.cwd()): Promise<string> {
  if (!/^[\w./@^~-]+$/.test(base)) throw new Error(`Refusing suspicious base ref: ${base}`);
  const { stdout } = await run("git", ["diff", "--no-color", "--no-ext-diff", `${base}...HEAD`], {
    cwd,
    maxBuffer: MAX_DIFF_BYTES * 2,
  });
  if (Buffer.byteLength(stdout) > MAX_DIFF_BYTES) throw new Error("Diff is larger than 1 MB; pass a file list instead");
  return stdout;
}

/** `owner/name` from a GitHub remote URL (https or ssh), or null. */
export function repoFromRemote(url: string): string | null {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function originRepo(cwd = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["remote", "get-url", "origin"], { cwd });
    return repoFromRemote(stdout);
  } catch {
    return null;
  }
}
