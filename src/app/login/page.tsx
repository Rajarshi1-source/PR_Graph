import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/icons";
import { getServerSession } from "@/lib/auth/serverSession";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getServerSession()) redirect("/dashboard");

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="bg-card w-full max-w-sm rounded-xl border p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Sign in to PRGraph</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Connect your GitHub account to visualize your repositories&apos; pull-request
            dependencies.
          </p>
          <Button className="mt-6 w-full" size="lg" render={<a href="/api/auth/github" />}>
            <GithubIcon className="size-4" /> Continue with GitHub
          </Button>
          <p className="text-muted-foreground mt-4 text-xs">
            We request read-only access. Tokens are encrypted at rest.
          </p>
        </div>
      </main>
    </>
  );
}
