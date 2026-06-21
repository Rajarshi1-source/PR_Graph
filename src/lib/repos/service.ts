import { prisma } from "@/lib/db/prisma";
import { invalidateGraph } from "@/lib/cache/graphCache";

export interface RepoListItem {
  id: number;
  fullName: string;
  isActive: boolean;
  lastSyncAt: Date | null;
  prCount: number;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  hasNext: boolean;
}

/** Paginated list of the repos connected to a user. */
export async function listReposForUser(
  userId: number,
  page: number,
  perPage: number,
): Promise<PageResult<RepoListItem>> {
  const where = { installation: { userId } };
  const [total, repos] = await Promise.all([
    prisma.repository.count({ where }),
    prisma.repository.findMany({
      where,
      include: { _count: { select: { pullRequests: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return {
    items: repos.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      isActive: r.isActive,
      lastSyncAt: r.lastSyncAt,
      prCount: r._count.pullRequests,
    })),
    page,
    perPage,
    total,
    hasNext: page * perPage < total,
  };
}

/** A repo the user owns (via installation), or null. */
export async function getRepoForUser(repoId: number, userId: number) {
  return prisma.repository.findFirst({
    where: { id: repoId, installation: { userId } },
  });
}

/** Disconnect a repo (cascade removes PRs/files/deps/snapshots). Returns false if not owned. */
export async function deleteRepoForUser(repoId: number, userId: number): Promise<boolean> {
  const owned = await prisma.repository.findFirst({
    where: { id: repoId, installation: { userId } },
    select: { id: true },
  });
  if (!owned) return false;
  await prisma.repository.delete({ where: { id: repoId } });
  await invalidateGraph(repoId);
  return true;
}
