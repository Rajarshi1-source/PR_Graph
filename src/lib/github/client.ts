import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import { env } from "@/lib/env";

/**
 * Authenticated Octokit clients.
 *
 * - `octokitFor(installationId)` acts AS THE INSTALLATION (security-and-api.md §A.1): all
 *   PR/file reads for the graph use a short-lived installation token minted from the App's
 *   private key. Octokit's App auth strategy mints + caches these.
 * - `octokitForToken(userToken)` acts as the user (login-time reads only).
 */
export function octokitFor(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID!,
      privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY!),
      installationId,
    },
  });
}

export function octokitForToken(userToken: string): Octokit {
  return new Octokit({ auth: userToken });
}

/** Allow the private key to be supplied with literal "\n" escapes (common in env vars). */
function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}
