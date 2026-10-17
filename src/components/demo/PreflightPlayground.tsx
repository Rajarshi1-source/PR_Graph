"use client";

import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { PreflightResult } from "@/lib/graph/preflight";

const SAMPLES: { label: string; patch: string }[] = [
  {
    label: "Edit session validation",
    patch: [
      "diff --git a/src/auth/session.ts b/src/auth/session.ts",
      "@@ -42,1 +42,1 @@ export function validateSession",
      "-  return verify(token);",
      "+  return verify(token, { maxAge: '1h' });",
    ].join("\n"),
  },
  {
    label: "Call loadUser() somewhere new",
    patch: [
      "diff --git a/apps/web/src/app/settings/page.tsx b/apps/web/src/app/settings/page.tsx",
      "@@ -9,0 +10,1 @@",
      "+  const user = await loadUser(await sessionId());",
    ].join("\n"),
  },
  {
    label: "Unrelated docs change",
    patch: ["diff --git a/docs/ARCHITECTURE.md b/docs/ARCHITECTURE.md", "@@ -1,1 +1,1 @@", "-# Architecture", "+# Architecture overview"].join("\n"),
  },
];

const RISK = {
  none: "text-status-safe",
  low: "text-status-at-risk",
  high: "text-status-blocked",
} as const;

/**
 * Feature D, interactive: paste a diff (what an AI agent or CI would send) and see which open demo
 * PRs it collides with — same engine and response as `POST /api/v1/preflight` and the MCP tool.
 */
export function PreflightPlayground() {
  const [open, setOpen] = useState(false);
  const [patch, setPatch] = useState(SAMPLES[0].patch);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? `Request failed (${res.status})`);
      setResult(body as PreflightResult);
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Bot className="size-4" />
        <span className="hidden sm:inline">Preflight</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Agent preflight</SheetTitle>
            <SheetDescription>
              Paste a diff — what a coding agent (via the <code>prgraph-mcp</code> server) or a CI step would send — and see
              which open PRs it would collide with.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {SAMPLES.map((s) => (
                <Button
                  key={s.label}
                  size="xs"
                  variant={patch === s.patch ? "secondary" : "ghost"}
                  onClick={() => {
                    setPatch(s.patch);
                    setResult(null);
                  }}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            <label htmlFor="preflight-patch" className="sr-only">
              Unified diff
            </label>
            <textarea
              id="preflight-patch"
              value={patch}
              onChange={(e) => setPatch(e.target.value)}
              rows={8}
              spellCheck={false}
              className="bg-muted w-full rounded-md border p-2 font-mono text-xs"
            />
            <Button onClick={run} disabled={busy || !patch.trim()}>
              {busy && <Loader2 className="size-4 animate-spin" />} Check for collisions
            </Button>

            {error && <p className="text-status-blocked">{error}</p>}
            {result && (
              <div className="space-y-2" role="status" aria-label="Preflight result">
                <p className={cn("font-semibold", RISK[result.risk])}>Risk: {result.risk}</p>
                <p>{result.recommendation}</p>
                <ul className="space-y-2">
                  {result.collisions.map((c) => (
                    <li key={c.pr.number} className="rounded-md border p-2 text-xs">
                      <p className="font-medium">
                        #{c.pr.number} {c.pr.title}{" "}
                        <span className="text-muted-foreground font-normal">
                          · {c.kind.toLowerCase()} · {c.direction === "wait" ? "merge it first" : "you break it"}
                          {c.blocking ? " · blocking" : ""}
                        </span>
                      </p>
                      {c.regions.map((r, i) => (
                        <p key={i} className="text-muted-foreground">
                          {r.file} base line {r.baseStart}
                          {r.baseEnd > r.baseStart ? `–${r.baseEnd}` : ""}
                        </p>
                      ))}
                      {c.symbols.map((s) => (
                        <p key={s.name} className="text-muted-foreground">
                          <code>{s.name}</code> {s.change} in {s.defFile}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
