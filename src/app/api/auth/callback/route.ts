import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { octokitForToken } from "@/lib/github/client";
import { seal } from "@/lib/crypto/secretbox";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/** OAuth callback: exchange the code, upsert the user, create a session. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const savedState = req.cookies.get("prg_oauth_state")?.value;

  if (!code) return problem(400, "Missing authorization code");
  if (!state || state !== savedState) return problem(400, "Invalid OAuth state");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_URL}/api/auth/callback`,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenJson.access_token;
  if (!accessToken) return problem(502, "OAuth token exchange failed");

  const octokit = octokitForToken(accessToken);
  const { data: gh } = await octokit.rest.users.getAuthenticated();

  const user = await prisma.user.upsert({
    where: { githubId: gh.id },
    create: {
      githubId: gh.id,
      username: gh.login,
      email: gh.email ?? null,
      avatarUrl: gh.avatar_url,
      accessToken: seal(accessToken),
    },
    update: {
      username: gh.login,
      avatarUrl: gh.avatar_url,
      accessToken: seal(accessToken),
    },
  });

  const res = NextResponse.redirect(new URL("/dashboard", env.APP_URL));
  res.cookies.set(SESSION_COOKIE, createSessionToken({ userId: user.id, login: user.username }), sessionCookieOptions);
  res.cookies.delete("prg_oauth_state");
  return res;
}
