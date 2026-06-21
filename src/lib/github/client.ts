import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import { env } from "@/lib/env";

/**
 * Authenticated Octokit clients.
 *
 * - `octokitFor(installationId)` acts AS THE INSTALLATION (security-and-api.md §A.1): all
 *   PR/file reads for the graph use a short-lived installation token minted from the App's
 *   private key. Octokit's App auth strategy mints + caches these.
 * - `octokitApp()` acts as the APP ITSELF (JWT) for app-level endpoints (e.g. reading an
 *   installation's account when provisioning).
 * - `octokitForToken(userToken)` acts as the user (login-time reads only).
 *
 * Installation clients are cached per installation id (singleton, hot-reload safe) so we don't
 * re-create Octokit + re-run the auth strategy on every request (backend skill: client singletons).
 */
const globalForOctokit = globalThis as unknown as {
  octokitByInstall?: Map<number, Octokit>;
  octokitApp?: Octokit;
};

const installCache = (globalForOctokit.octokitByInstall ??= new Map<number, Octokit>());

export function octokitFor(installationId: number): Octokit {
  const cached = installCache.get(installationId);
  if (cached) return cached;
  const client = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID!,
      privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY!),
      installationId,
    },
  });
  installCache.set(installationId, client);
  return client;
}

export function octokitApp(): Octokit {
  return (globalForOctokit.octokitApp ??= new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID!,
      privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY!),
    },
  }));
}

export function octokitForToken(userToken: string): Octokit {
  return new Octokit({ auth: userToken });
}

/** Allow the private key to be supplied with literal "\n" escapes (common in env vars). */
function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}
