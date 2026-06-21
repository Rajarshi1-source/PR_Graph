import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { getServerSession } from "@/lib/auth/serverSession";
import { getInitialGraph } from "@/lib/graph/service";

type Params = Promise<{ owner: string; name: string }>;

// params is async in Next.js 16 — await before use.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { owner, name } = await params;
  return {
    title: `${owner}/${name}`,
    description: `Pull-request dependency graph for ${owner}/${name}.`,
  };
}

export default async function RepoGraphPage({ params }: { params: Params }) {
  const { owner, name } = await params;

  if (!(await getServerSession())) redirect("/login");

  const result = await getInitialGraph(owner, name);
  if (!result) notFound();

  return (
    <>
      <SiteHeader showAuth />
      <main className="flex-1">
        <div className="h-[calc(100vh-3.5rem)]">
          <GraphCanvas
            repoId={result.repoId}
            fullName={`${owner}/${name}`}
            initialGraph={result.graph}
          />
        </div>
      </main>
    </>
  );
}
