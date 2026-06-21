import crypto from "node:crypto";
import { env } from "@/lib/env";

/**
 * Verify the GitHub webhook HMAC-SHA256 over the RAW request body, constant-time
 * (security-and-api.md §A.3). Always verify against the raw body, never the parsed JSON.
 */
export function verifyGithubSignature(rawBody: string, signatureHeader: string): boolean {
  if (!env.GITHUB_WEBHOOK_SECRET) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
