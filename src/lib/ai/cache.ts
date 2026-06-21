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
  const hash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return `ai:verdict:${promptVersion}:${hash}`;
}

export async function getCachedVerdict(key: string): Promise<ConflictVerdict | null> {
  const hit = await redis.get(key);
  if (!hit) return null;
  const parsed = VerdictSchema.safeParse(JSON.parse(hit));
  return parsed.success ? parsed.data : null;
}

export async function setCachedVerdict(key: string, verdict: ConflictVerdict): Promise<void> {
  await redis.set(key, JSON.stringify(verdict), "EX", TTL_SECONDS);
}
