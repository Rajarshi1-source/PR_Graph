import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GitPullRequest, Network, Plus } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { getServerSession } from "@/lib/auth/serverSession";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const repos = await prisma.repository.findMany({
    where: { installation: { userId: session.userId } },
    include: { _count: { select: { pullRequests: true } } },
    orderBy: { createdAt: "desc" },
  });

  const installUrl = env.GITHUB_APP_SLUG
    ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`
    : null;

  return (
    <>
      <SiteHeader showAuth />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Repositories</h1>
            <p className="text-muted-foreground text-sm">
              Signed in as {session.login}
            </p>
          </div>
          {installUrl && (
            <Button render={<a href={installUrl} />}>
              <Plus className="size-4" /> Add repositories
            </Button>
          )}
        </div>

        {repos.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <Network className="text-muted-foreground size-8" aria-hidden />
            <p className="font-medium">No repositories connected yet</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Install the PRGraph GitHub App on a repository to start visualizing its
              pull-request dependencies.
            </p>
            {installUrl && (
              <Button render={<a href={installUrl} />} className="mt-1">
                <Plus className="size-4" /> Install GitHub App
              </Button>
            )}
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {repos.map((repo) => {
              const [owner, name] = repo.fullName.split("/");
              return (
                <li key={repo.id}>
                  <Link href={`/repo/${owner}/${name}`}>
                    <Card className="hover:border-primary/50 gap-2 p-4 transition-colors">
                      <div className="flex items-center gap-2 font-medium">
                        <Network className="text-primary size-4" aria-hidden />
                        <span className="truncate">{repo.fullName}</span>
                      </div>
                      <div className="text-muted-foreground flex items-center gap-1 text-sm">
                        <GitPullRequest className="size-3.5" aria-hidden />
                        {repo._count.pullRequests} open PRs
                        {repo.lastSyncAt && (
                          <span className="ml-auto text-xs">
                            synced {new Date(repo.lastSyncAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
