import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { DemoGraphCanvas } from "@/components/demo/DemoGraphCanvas";
import { buildDemoGraph, DEMO_REPO } from "@/lib/demo/fixtures";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Live demo",
  description: "Explore PRGraph on a demo repository: line-level PR conflicts, cross-file symbol impact, and a merge plan.",
};

// DEMO_ENABLED is a runtime flag.
export const dynamic = "force-dynamic";

export default function DemoPage() {
  if (!env.DEMO_ENABLED) notFound();
  const graph = buildDemoGraph();

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="h-[calc(100vh-3.5rem)]">
          <DemoGraphCanvas graph={graph} repoName={DEMO_REPO} />
        </div>
      </main>
    </>
  );
}
