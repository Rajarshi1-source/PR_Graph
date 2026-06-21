import { env } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { octokitForToken } from "@/lib/github/client";
import { seal } from "@/lib/crypto/secretbox";

export class OAuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Exchange an OAuth code for a user access token (security-and-api.md §A.1). */
async function exchangeCode(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_URL}/api/auth/callback`,
    }),
  });
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new OAuthError(502, "OAuth token exchange failed");
  return json.access_token;
}

/** Run the full login: exchange code, read the GitHub user, upsert + seal the token. */
export async function loginWithOAuthCode(
  code: string,
): Promise<{ id: number; username: string }> {
  const accessToken = await exchangeCode(code);
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
    update: { username: gh.login, avatarUrl: gh.avatar_url, accessToken: seal(accessToken) },
  });

  return { id: user.id, username: user.username };
}
