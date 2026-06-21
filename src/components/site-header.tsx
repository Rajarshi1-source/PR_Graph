import Link from "next/link";
import { Network } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { LogoutButton } from "./logout-button";

export function SiteHeader({ showAuth = false }: { showAuth?: boolean }) {
  return (
    <header className="bg-background/80 sticky top-0 z-20 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Network className="text-primary size-5" aria-hidden />
          PRGraph
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {showAuth && <LogoutButton />}
        </div>
      </div>
    </header>
  );
}
