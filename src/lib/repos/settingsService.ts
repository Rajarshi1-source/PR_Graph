import { prisma } from "@/lib/db/prisma";
import { parseRepoSettings, type RepoSettings } from "./settings";

/** Merge a partial update into a repo's settings (owner only). Returns null when not owned. */
export async function updateRepoSettings(
  repoId: number,
  userId: number,
  patch: Partial<RepoSettings>,
): Promise<RepoSettings | null> {
  const repo = await prisma.repository.findFirst({
    where: { id: repoId, installation: { userId } },
    select: { id: true, settings: true },
  });
  if (!repo) return null;
  const next = parseRepoSettings({ ...parseRepoSettings(repo.settings), ...patch });
  await prisma.repository.update({ where: { id: repoId }, data: { settings: next } });
  return next;
}
