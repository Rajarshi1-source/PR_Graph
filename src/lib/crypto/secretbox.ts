import crypto from "node:crypto";
import { env } from "@/lib/env";

/**
 * AES-256-GCM seal/open for tokens stored at rest (security-and-api.md §A.5).
 * Stored format: base64(iv):base64(authTag):base64(ciphertext).
 *
 * Key resolution: ENCRYPTION_KEY (base64, 32 bytes) when provided; otherwise a key derived
 * from SESSION_SECRET as a development fallback. In production a real ENCRYPTION_KEY is required.
 */
function resolveKey(): Buffer {
  if (env.ENCRYPTION_KEY) {
    const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
    if (key.length !== 32) {
      throw new Error("ENCRYPTION_KEY must be base64-encoded 32 bytes");
    }
    return key;
  }
  if (env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY is required in production");
  }
  // Dev fallback: derive a deterministic 32-byte key from SESSION_SECRET.
  return crypto.createHash("sha256").update(env.SESSION_SECRET ?? "dev").digest();
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  // Resolved lazily so importing this module never throws (e.g. during `next build`).
  return (cachedKey ??= resolveKey());
}

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function open(sealed: string): string {
  const [iv, tag, ct] = sealed.split(":").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
