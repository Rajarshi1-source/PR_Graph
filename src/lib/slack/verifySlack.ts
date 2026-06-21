import crypto from "node:crypto";
import { env } from "@/lib/env";

/**
 * Verify a Slack request signature (v0 scheme) over the raw body, with replay protection
 * (security-and-api.md §A.4). Reject requests older than 5 minutes.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  if (!env.SLACK_SIGNING_SECRET || !timestamp || !signature) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", env.SLACK_SIGNING_SECRET).update(base).digest("hex");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
