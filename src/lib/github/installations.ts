import { prisma } from "@/lib/db/prisma";
import { installationsTotal } from "@/lib/metrics";
import { octokitApp, octokitFor } from "./client";

/**
 * GitHub App installation provisioning (plan §5.5, security-and-api.md §A.1, §B.5).
 *
 * This is the path that actually connects repos to PRGraph: a user logs in via OAuth, installs
 * the GitHub App, and either the post-install setup redirect (`/api/github/setup`) or the
 * `installation` / `installation_repositories` webhooks call into here to create/refresh the
 * `Installation` + `Repository` rows. Without this, the dashboard and graph APIs stay empty.
 */
interface AccessibleRepo {
  id: number;
  full_name: string;
  default_branch?: string;
}

/** Mirror the installation's accessible repos into the DB (upsert present, remove absent). */
export async function syncInstallationRepos(
  installationDbId: number,
  githubInstallId: number,
): Promise<void> {
  const octokit = octokitFor(githubInstallId);
  const repos = (await octokit.paginate(
    octokit.rest.apps.listReposAccessibleToInstallation,
    { per_page: 100 },
  )) as unknown as AccessibleRepo[];

  const keepGithubIds: number[] = [];
  for (const r of repos) {
    keepGithubIds.push(r.id);
    await prisma.repository.upsert({
      where: {
        installationId_githubRepoId: { installationId: installationDbId, githubRepoId: r.id },
      },
      create: {
        installationId: installationDbId,
        githubRepoId: r.id,
        fullName: r.full_name,
        defaultBranch: r.default_branch ?? "main",
      },
      update: { fullName: r.full_name, defaultBranch: r.default_branch ?? "main", isActive: true },
    });
  }

  // Remove repos the installation can no longer access (cascades PRs/files/deps/snapshots).
  await prisma.repository.deleteMany({
    where: {
      installationId: installationDbId,
      githubRepoId: { notIn: keepGithubIds.length ? keepGithubIds : [-1] },
    },
  });
}

/** Create/refresh an installation for a known user, then sync its repos. */
export async function provisionInstallation(params: {
  githubInstallId: number;
  userId: number;
  account?: { login: string; type: string };
}): Promise<void> {
  let account = params.account;
  if (!account) {
    const { data } = await octokitApp().rest.apps.getInstallation({
      installation_id: params.githubInstallId,
    });
    const acct = data.account as { login?: string; slug?: string; type?: string } | null;
    account = { login: acct?.login ?? acct?.slug ?? "unknown", type: acct?.type ?? "User" };
  }

  const installation = await prisma.installation.upsert({
    where: { githubInstallId: params.githubInstallId },
    create: {
      githubInstallId: params.githubInstallId,
      userId: params.userId,
      accountLogin: account.login,
      accountType: account.type,
    },
    update: { userId: params.userId, accountLogin: account.login, accountType: account.type },
  });

  await syncInstallationRepos(installation.id, params.githubInstallId);
  installationsTotal.inc({ action: "provisioned" });
}

interface InstallationPayload {
  action?: string;
  installation?: { id?: number; account?: { login?: string; type?: string } };
  sender?: { id?: number };
}

/** Handle the `installation` webhook (created / deleted / suspend / new_permissions). */
export async function handleInstallationWebhook(payload: InstallationPayload): Promise<void> {
  const githubInstallId = payload.installation?.id;
  if (!githubInstallId) return;

  if (payload.action === "deleted") {
    await prisma.installation.deleteMany({ where: { githubInstallId } });
    installationsTotal.inc({ action: "deleted" });
    return;
  }

  const existing = await prisma.installation.findUnique({ where: { githubInstallId } });
  if (existing) {
    await syncInstallationRepos(existing.id, githubInstallId);
    return;
  }

  // First time we see it via webhook: attach to the user who installed it (must have logged in).
  const senderId = payload.sender?.id;
  const user = senderId ? await prisma.user.findUnique({ where: { githubId: senderId } }) : null;
  if (!user) return; // can't attach an installation to an unknown user; setup redirect will fix it

  const acct = payload.installation?.account;
  await provisionInstallation({
    githubInstallId,
    userId: user.id,
    account: acct?.login ? { login: acct.login, type: acct.type ?? "User" } : undefined,
  });
}

/** Handle the `installation_repositories` webhook (repos added / removed). */
export async function handleInstallationReposWebhook(payload: InstallationPayload): Promise<void> {
  const githubInstallId = payload.installation?.id;
  if (!githubInstallId) return;

  const existing = await prisma.installation.findUnique({ where: { githubInstallId } });
  if (existing) {
    await syncInstallationRepos(existing.id, githubInstallId);
    return;
  }

  const senderId = payload.sender?.id;
  const user = senderId ? await prisma.user.findUnique({ where: { githubId: senderId } }) : null;
  if (user) await provisionInstallation({ githubInstallId, userId: user.id });
}
