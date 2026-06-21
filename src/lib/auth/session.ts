import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Stateless signed-cookie session (security-and-api.md §A.2): carries only userId + login,
 * no tokens. Token = base64url(JSON payload).base64url(HMAC-SHA256). httpOnly/Secure/SameSite
 * are applied when the cookie is set on the response (see the auth callback route).
 */
export const SESSION_COOKIE = "prg_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionData {
  userId: number;
  login: string;
  exp: number; // unix seconds
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payload: string): string {
  return b64url(
    crypto.createHmac("sha256", env.SESSION_SECRET ?? "dev").update(payload).digest(),
  );
}

export function createSessionToken(data: Omit<SessionData, "exp">): string {
  const full: SessionData = { ...data, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  const payload = b64url(Buffer.from(JSON.stringify(full)));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): SessionData | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionData;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Read + verify the session from a request, or null. Routes return problem(401) on null. */
export function getSession(req: NextRequest): SessionData | null {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
