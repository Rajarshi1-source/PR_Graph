import Link from "next/link";
import {
  Network,
  Zap,
  Bell,
  GitMerge,
  Braces,
  ListOrdered,
  Bot,
  Sparkles,
  History,
  PlayCircle,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/icons";
import { statusMeta, STATUS_ORDER } from "@/components/graph/statusMeta";
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";

// The demo link depends on the runtime DEMO_ENABLED flag, not the build environment.
export const dynamic = "force-dynamic";

const differentiators = [
  {
    icon: GitMerge,
    title: "Predicts PR-vs-PR conflicts",
    body: "Compares every pair of open PRs line by line in base coordinates — and replays git's merge with diff3 when branches drift. You see the exact lines that will collide before anyone merges.",
  },
  {
    icon: Braces,
    title: "Catches cross-file breakage",
    body: "PR A renames getUser(), PR B adds a new call to it in another file. Git merges cleanly; the build breaks. PRGraph links them before it happens.",
  },
  {
    icon: ListOrdered,
    title: "A merge plan, not just an order",
    body: "Combines the conflict graph with CI, reviews and branch rules into parallel merge batches, parks what isn't ready (and says why), and highlights the critical path.",
  },
  {
    icon: Bot,
    title: "Preflight for AI agents & CI",
    body: "An MCP server and API answer “will my change collide with an open PR?” before a PR exists — plus an opt-in GitHub Check Run on every PR.",
  },
];

const features = [
  {
    icon: Zap,
    title: "Live updates",
    body: "Webhooks recompute the graph and push changes over WebSockets; CI and review events update the plan in seconds.",
  },
  {
    icon: Sparkles,
    title: "AI that knows its limits",
    body: "An optional LLM explains conflicts and suggests resolutions — but never overrides an exact textual conflict, and falls back to the deterministic engine.",
  },
  {
    icon: Bell,
    title: "Slack unblock alerts",
    body: "When a merge frees other PRs, your channel hears exactly what's unblocked and what to merge next.",
  },
  {
    icon: History,
    title: "History & export",
    body: "Replay what changed between computations, simulate merges, and export PNG, SVG, Mermaid or JSON.",
  },
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:py-24">
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">
            Know which PRs will <span className="text-status-blocked">collide</span> — before anyone merges
          </h1>
          <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-pretty">
            PRGraph turns your open pull requests into a live dependency graph: line-level conflicts between PRs,
            cross-file symbol breakage, and a merge plan that respects CI and reviews.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button size="lg" render={<Link href="/login" />}>
              <GithubIcon className="size-4" /> Connect GitHub
            </Button>
            {env.DEMO_ENABLED && (
              <Button size="lg" variant="outline" render={<Link href="/demo" />}>
                <PlayCircle className="size-4" /> Try the live demo
              </Button>
            )}
            <Button size="lg" variant="ghost" render={<a href="#how" />}>
              How it works
            </Button>
          </div>

          <ul className="mx-auto mt-12 grid max-w-md gap-2 text-left text-sm">
            {STATUS_ORDER.map((s) => {
              const Icon = statusMeta[s].icon;
              return (
                <li key={s} className="flex items-center gap-2">
                  <Icon className={cn("size-4", statusMeta[s].text)} aria-hidden />
                  <span className="font-medium">{statusMeta[s].label}</span>
                  <span className="text-muted-foreground">
                    {s === "SAFE"
                      ? "— no other PR touches this code"
                      : s === "AT_RISK"
                        ? "— shares files, merges cleanly"
                        : s === "BLOCKED"
                          ? "— another PR must land first"
                          : "— PRs depend on each other"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section id="how" className="border-t" aria-labelledby="diff-heading">
          <div className="mx-auto max-w-5xl px-4 py-16">
            <h2 id="diff-heading" className="mb-2 text-center text-2xl font-semibold">
              What merge queues and AI reviewers don&apos;t see
            </h2>
            <p className="text-muted-foreground mx-auto mb-10 max-w-2xl text-center text-sm">
              Merge queues find conflicts only once a PR is queued. AI reviewers read one PR at a time. PRGraph looks at
              all open PRs together.
            </p>
            <div className="grid gap-6 sm:grid-cols-2">
              {differentiators.map(({ icon: Icon, title, body }) => (
                <div key={title} className="bg-card rounded-xl border p-6">
                  <Icon className="text-primary size-6" aria-hidden />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t" aria-label="More features">
          <div className="mx-auto grid max-w-5xl gap-6 px-4 py-16 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon className="text-muted-foreground size-5" aria-hidden />
                <h3 className="mt-2 text-sm font-semibold">{title}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="text-muted-foreground border-t py-6 text-center text-sm">
        <Network className="mr-1 inline size-4 align-text-bottom" aria-hidden />
        PRGraph — open-source PR dependency visualizer.
      </footer>
    </>
  );
}
