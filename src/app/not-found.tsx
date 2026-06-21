import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-3xl font-bold">404</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          That page or repository graph couldn&apos;t be found.
        </p>
        <Button render={<Link href="/dashboard" />}>Back to dashboard</Button>
      </main>
    </>
  );
}
