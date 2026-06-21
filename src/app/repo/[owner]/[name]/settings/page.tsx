import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SlackSettings } from "@/components/slack/SlackSettings";
import { Button } from "@/components/ui/button";
import { getServerSession } from "@/lib/auth/serverSession";
import { prisma } from "@/lib/db/prisma";

type Params = Promise<{ owner: string; name: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { owner, name } = await params;
  return { title: `Settings · ${owner}/${name}` };
}

export default async function RepoSettingsPage({ params }: { params: Params }) {
  const { owner, name } = await params;
  const session = await getServerSession();
  if (!session) redirect("/login");

  const repo = await prisma.repository.findFirst({
    where: { fullName: `${owner}/${name}`, installation: { userId: session.userId } },
    select: { id: true, fullName: true },
  });
  if (!repo) notFound();

  return (
    <>
      <SiteHeader showAuth />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          render={<Link href={`/repo/${owner}/${name}`} />}
        >
          <ArrowLeft className="size-4" /> Back to graph
        </Button>
        <h1 className="mb-1 text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground mb-6 text-sm">{repo.fullName}</p>
        <SlackSettings repoId={repo.id} />
      </main>
    </>
  );
}
