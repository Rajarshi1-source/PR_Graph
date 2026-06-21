import crypto from "node:crypto";
import { redis } from "@/lib/cache/redis";
import { VerdictSchema, type ConflictInput, type ConflictVerdict } from "./types";

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Content-addressed cache key (plan §15): same prompt version + same diffs ⇒ same key, so an
 * identical analysis is never paid for twice and changing the prompt invalidates everything.
 */
export function verdictKey(promptVersion: string, input: ConflictInput): string {
  const canonical = JSON.stringify({
    v: promptVersion,
    files: [...input.sharedFiles].sort(),
    a: input.diffA,
    b: input.diffB,
  });
  const hash = crypto.createHash("sha256").update(canonical).digest("hex");
  return `ai:verdict:${promptVersion}:${hash}`;
}

/**
 * A missing/slow Redis must never stall conflict analysis (the analyzer treats a rejection as a
 * cache miss and falls back). Bound every cache op so an unavailable Redis degrades in ~1s instead
 * of hanging forever — important offline (the heuristic eval runs with no Redis service).
 */
const CACHE_OP_TIMEOUT_MS = 400;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("redis timeout")), ms);
    if (typeof t.unref === "function") t.unref();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function getCachedVerdict(key: string): Promise<ConflictVerdict | null> {
  const hit = await withTimeout(redis.get(key), CACHE_OP_TIMEOUT_MS);
  if (!hit) return null;
  const parsed = VerdictSchema.safeParse(JSON.parse(hit));
  return parsed.success ? parsed.data : null;
}

export async function setCachedVerdict(key: string, verdict: ConflictVerdict): Promise<void> {
  await withTimeout(redis.set(key, JSON.stringify(verdict), "EX", TTL_SECONDS), CACHE_OP_TIMEOUT_MS);
}
