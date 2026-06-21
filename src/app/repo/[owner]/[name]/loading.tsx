import { Network } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Skeleton } from "@/components/ui/skeleton";

/** Route-segment loading UI shown while the repo graph is fetched on the server. */
export default function RepoLoading() {
  return (
    <>
      <SiteHeader showAuth />
      <main className="flex-1">
        <div className="flex h-[calc(100vh-3.5rem)] flex-col">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <Skeleton className="h-5 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-8" />
            </div>
          </div>
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2">
            <Network className="size-8 animate-pulse" aria-hidden />
            <p className="text-sm">Loading dependency graph…</p>
          </div>
        </div>
      </main>
    </>
  );
}
