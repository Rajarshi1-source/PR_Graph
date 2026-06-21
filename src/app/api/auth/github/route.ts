import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/** Start the GitHub OAuth flow (security-and-api.md §A.1). */
export async function GET() {
  if (!env.GITHUB_CLIENT_ID) return problem(503, "GitHub OAuth not configured");

  const state = crypto.randomBytes(16).toString("hex");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${env.APP_URL}/api/auth/callback`);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("prg_oauth_state", state, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
