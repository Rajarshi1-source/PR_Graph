import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GitPullRequest, Network, Plus } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { getServerSession } from "@/lib/auth/serverSession";
import { getOverview } from "@/lib/repos/overview";
import { env } from "@/lib/env";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { statusMeta, STATUS_ORDER } from "@/components/graph/statusMeta";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { repos, blocked } = await getOverview(session.userId);

  const installUrl = env.GITHUB_APP_SLUG
    ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`
    : null;

  return (
    <>
      <SiteHeader showAuth />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Repositories</h1>
            <p className="text-muted-foreground text-sm">Signed in as {session.login}</p>
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
              Install the PRGraph GitHub App on a repository to start visualizing its pull-request dependencies.
            </p>
            {installUrl && (
              <Button render={<a href={installUrl} />} className="mt-1">
                <Plus className="size-4" /> Install GitHub App
              </Button>
            )}
            <Button variant="ghost" render={<Link href="/demo" />}>
              Or explore the live demo
            </Button>
          </Card>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
            <ul className="grid content-start gap-3 sm:grid-cols-2">
              {repos.map((repo) => {
                const [owner, name] = repo.fullName.split("/");
                return (
                  <li key={repo.id}>
                    <Link href={`/repo/${owner}/${name}`} className="focus-visible:ring-ring block rounded-xl focus-visible:ring-2 focus-visible:outline-none">
                      <Card className="hover:border-primary/50 gap-3 p-4 transition-colors">
                        <div className="flex items-center gap-2 font-medium">
                          <Network className="text-primary size-4" aria-hidden />
                          <span className="truncate">{repo.fullName}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {STATUS_ORDER.map((s) => {
                            const Icon = statusMeta[s].icon;
                            return (
                              <span key={s} className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5", statusMeta[s].chip)} title={statusMeta[s].label}>
                                <Icon className="size-3" aria-hidden />
                                <span className="tabular-nums">{repo.counts[s]}</span>
                                <span className="sr-only">{statusMeta[s].label}</span>
                              </span>
                            );
                          })}
                          <Sparkline
                            values={repo.blockedTrend}
                            label={`Blocked PRs over the last ${repo.blockedTrend.length} computations`}
                            className="text-status-blocked ml-auto"
                          />
                        </div>
                        <div className="text-muted-foreground flex items-center gap-1 text-sm">
                          <GitPullRequest className="size-3.5" aria-hidden />
                          {repo.prCount} open PRs
                          {repo.lastSyncAt && (
                            <span className="ml-auto text-xs">synced {new Date(repo.lastSyncAt).toLocaleDateString()}</span>
                          )}
                        </div>
                        {repo.topBlocker && (
                          <p className="text-muted-foreground truncate text-xs">
                            Biggest blocker: <span className="text-foreground">#{repo.topBlocker.number}</span> {repo.topBlocker.title} (holds{" "}
                            {repo.topBlocker.holds})
                          </p>
                        )}
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <section aria-labelledby="blocked-heading">
              <h2 id="blocked-heading" className="mb-2 font-semibold">
                Blocked across all repos <span className="text-muted-foreground font-normal">({blocked.length})</span>
              </h2>
              {blocked.length === 0 ? (
                <Card className="text-muted-foreground p-4 text-sm">Nothing is blocked. 🎉</Card>
              ) : (
                <Card className="divide-y p-0">
                  {blocked.slice(0, 50).map((b) => {
                    const [owner, name] = b.repo.split("/");
                    const Icon = statusMeta[b.status].icon;
                    return (
                      <Link
                        key={`${b.repo}#${b.number}`}
                        href={`/repo/${owner}/${name}`}
                        className="hover:bg-muted flex items-start gap-2 px-3 py-2 text-sm"
                      >
                        <Icon className={cn("mt-0.5 size-3.5 shrink-0", statusMeta[b.status].text)} aria-label={statusMeta[b.status].label} />
                        <span className="min-w-0">
                          <span className="block truncate">
                            <span className="font-medium">#{b.number}</span> {b.title}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {b.repo}
                            {b.waitsOn.length ? ` · waits on ${b.waitsOn.map((n) => `#${n}`).join(", ")}` : ""}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </Card>
              )}
            </section>
          </div>
        )}
      </main>
    </>
  );
}
