import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { HistoryTimeline } from "@/components/history/HistoryTimeline";
import { Button } from "@/components/ui/button";
import { getServerSession } from "@/lib/auth/serverSession";
import { getGraphHistory } from "@/lib/graph/service";
import { prisma } from "@/lib/db/prisma";

type Params = Promise<{ owner: string; name: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { owner, name } = await params;
  return { title: `History · ${owner}/${name}` };
}

export default async function RepoHistoryPage({ params }: { params: Params }) {
  const { owner, name } = await params;
  const session = await getServerSession();
  if (!session) redirect("/login");

  const repo = await prisma.repository.findFirst({
    where: { fullName: `${owner}/${name}`, installation: { userId: session.userId } },
    select: { id: true, fullName: true },
  });
  if (!repo) notFound();

  const history = await getGraphHistory(repo.id, session.userId, 1, 50);
  const items = (history?.items ?? []).map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }));

  return (
    <>
      <SiteHeader showAuth />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Button variant="ghost" size="sm" className="mb-4" render={<Link href={`/repo/${owner}/${name}`} />}>
          <ArrowLeft className="size-4" /> Back to graph
        </Button>
        <h1 className="mb-1 text-2xl font-semibold">History</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          {repo.fullName} — every recompute, and what changed since the one before.
        </p>
        <HistoryTimeline repoId={repo.id} items={items} />
      </main>
    </>
  );
}
