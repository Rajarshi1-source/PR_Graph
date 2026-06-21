import Link from "next/link";
import { CircleCheck, TriangleAlert, CircleX, Network, Zap, Bell } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/icons";

const features = [
  {
    icon: Network,
    title: "Dependency graph",
    body: "Every open PR becomes a node; shared-file overlaps become edges. Topological sort reveals the real merge order.",
  },
  {
    icon: Zap,
    title: "Live updates",
    body: "GitHub webhooks recompute the graph and push changes over WebSockets the instant a PR is merged or opened.",
  },
  {
    icon: Bell,
    title: "Slack unblock alerts",
    body: "When merging one PR frees up others, PRGraph tells your channel exactly what's now safe to merge.",
  },
];

const statuses = [
  { icon: CircleCheck, text: "text-status-safe", label: "Safe to merge — no upstream blockers" },
  { icon: TriangleAlert, text: "text-status-blocked", label: "Blocked — waiting on another PR" },
  { icon: CircleX, text: "text-status-deadlocked", label: "Deadlocked — part of a dependency cycle" },
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-24 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">
            See which PRs are <span className="text-status-safe">safe to merge</span> — at a glance
          </h1>
          <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-pretty">
            PRGraph maps the hidden dependencies between your open pull requests into a live,
            interactive graph — so you always know the right merge order.
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <Button size="lg" render={<Link href="/login" />}>
              <GithubIcon className="size-4" /> Connect GitHub
            </Button>
            <Button size="lg" variant="outline" render={<a href="#how" />}>
              How it works
            </Button>
          </div>

          <ul className="mx-auto mt-12 grid max-w-md gap-2 text-left text-sm">
            {statuses.map(({ icon: Icon, text, label }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon className={`size-4 ${text}`} aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className="border-t">
          <div className="mx-auto grid max-w-5xl gap-6 px-4 py-16 sm:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-card rounded-xl border p-6">
                <Icon className="text-primary size-6" aria-hidden />
                <h2 className="mt-3 font-semibold">{title}</h2>
                <p className="text-muted-foreground mt-1 text-sm">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="text-muted-foreground border-t py-6 text-center text-sm">
        PRGraph — open-source PR dependency visualizer.
      </footer>
    </>
  );
}
