import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { loginWithOAuthCode, OAuthError } from "@/lib/auth/oauth";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/** OAuth callback: validate state, run the login service, set the session cookie. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const savedState = req.cookies.get("prg_oauth_state")?.value;

  if (!code) return problem(400, "Missing authorization code");
  if (!state || state !== savedState) return problem(400, "Invalid OAuth state");

  let user: { id: number; username: string };
  try {
    user = await loginWithOAuthCode(code);
  } catch (err) {
    if (err instanceof OAuthError) return problem(err.status, err.message);
    console.error("[auth/callback] login failed:", err);
    return problem(502, "Login failed");
  }

  const res = NextResponse.redirect(new URL("/dashboard", env.APP_URL));
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken({ userId: user.id, login: user.username }),
    sessionCookieOptions,
  );
  res.cookies.delete("prg_oauth_state");
  return res;
}
