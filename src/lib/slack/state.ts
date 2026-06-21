import crypto from "node:crypto";
import { env } from "@/lib/env";

/** Signed, short-lived OAuth `state` carrying the repo id through the Slack install flow. */
function sign(payload: string): string {
  return crypto
    .createHmac("sha256", env.SESSION_SECRET ?? "dev")
    .update(payload)
    .digest("base64url");
}

export function signState(repoId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ repoId, exp: Math.floor(Date.now() / 1000) + 600 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyState(token: string | null): { repoId: number } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      repoId: number;
      exp: number;
    };
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return { repoId: data.repoId };
  } catch {
    return null;
  }
}
