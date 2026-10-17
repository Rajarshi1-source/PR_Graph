"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import {
  useApiTokens,
  useCreateApiToken,
  useRepoSettings,
  useRevokeApiToken,
  useUpdateRepoSettings,
} from "@/hooks/useRepoIntegrations";

const onError = (fallback: string) => (err: unknown) =>
  toast.error(err instanceof ApiError ? err.message : fallback);

function Toggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** Check Run bot, AI toggle and engine globs (Feature D settings). */
export function IntegrationSettings({ repoId }: { repoId: number }) {
  const { data, isPending } = useRepoSettings(repoId);
  const update = useUpdateRepoSettings(repoId);
  const [draft, setDraft] = useState<{ ignore: string; workspaces: string } | null>(null);

  if (isPending || !data) return <Card className="p-6 text-sm">Loading…</Card>;
  const s = data.settings;
  const globs = draft ?? { ignore: s.ignoreGlobs.join("\n"), workspaces: s.workspaceGlobs.join("\n") };
  const save = (patch: Parameters<typeof update.mutate>[0], ok?: string) =>
    update.mutate(patch, { onSuccess: () => ok && toast.success(ok), onError: onError("Could not save settings") });
  const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <Card className="gap-4 p-6">
      <h2 className="font-semibold">Integrations</h2>
      <Toggle
        id="bot"
        label="PRGraph Check Run"
        hint="Post a “PRGraph” check on every open PR listing its conflicts, merge-plan step and AI notes. Needs the Checks (write) permission."
        checked={s.botEnabled}
        onChange={(v) => save({ botEnabled: v })}
      />
      <Toggle
        id="fail"
        label="Fail the check on conflicts"
        hint="Blocked or deadlocked PRs get a failing check, so you can make PRGraph a required status check."
        checked={s.failOnConflict}
        disabled={!s.botEnabled}
        onChange={(v) => save({ failOnConflict: v })}
      />
      <Toggle
        id="ai"
        label="AI semantic analysis"
        hint={
          data.aiAvailable
            ? "Let the LLM explain conflicts and demote approximate edges for this repo."
            : "AI is disabled on this deployment (AI_ENABLED=false) — the deterministic engine is used."
        }
        checked={s.aiEnabled && data.aiAvailable}
        disabled={!data.aiAvailable}
        onChange={(v) => save({ aiEnabled: v })}
      />
      <Separator />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ignore">Regenerable files (never block)</Label>
          <textarea
            id="ignore"
            rows={4}
            value={globs.ignore}
            onChange={(e) => setDraft({ ...globs, ignore: e.target.value })}
            placeholder={"docs/generated/**\n**/*.pb.go"}
            className="bg-background mt-1 w-full rounded-md border p-2 font-mono text-xs"
          />
        </div>
        <div>
          <Label htmlFor="ws">Monorepo workspaces</Label>
          <textarea
            id="ws"
            rows={4}
            value={globs.workspaces}
            onChange={(e) => setDraft({ ...globs, workspaces: e.target.value })}
            placeholder={"apps/*\npackages/*"}
            className="bg-background mt-1 w-full rounded-md border p-2 font-mono text-xs"
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">One glob per line. Lockfiles and snapshots are always regenerable. Applies from the next recompute.</p>
      <Button
        className="w-fit"
        size="sm"
        disabled={!draft || update.isPending}
        onClick={() => {
          save({ ignoreGlobs: lines(globs.ignore), workspaceGlobs: lines(globs.workspaces) }, "Globs saved");
          setDraft(null);
        }}
      >
        Save globs
      </Button>
    </Card>
  );
}

const SCOPES = [
  { id: "preflight:read", label: "Preflight" },
  { id: "graph:read", label: "Read graph & merge plan" },
];

/** Scoped API tokens for AI agents / CI (preflight + MCP). The secret is shown exactly once. */
export function ApiTokenSettings({ repoId, fullName, appUrl }: { repoId: number; fullName: string; appUrl: string }) {
  const { data } = useApiTokens(repoId);
  const create = useCreateApiToken(repoId);
  const revoke = useRevokeApiToken(repoId);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["preflight:read", "graph:read"]);
  const [days, setDays] = useState("90");
  const [fresh, setFresh] = useState<string | null>(null);

  const mcpConfig = fresh
    ? JSON.stringify(
        {
          mcpServers: {
            prgraph: {
              command: "npx",
              args: ["-y", "prgraph-mcp"],
              env: { PRGRAPH_URL: appUrl, PRGRAPH_TOKEN: fresh, PRGRAPH_REPO: fullName },
            },
          },
        },
        null,
        2,
      )
    : "";

  return (
    <Card className="gap-4 p-6">
      <div>
        <h2 className="font-semibold">API tokens for agents &amp; CI</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Let AI coding agents (via the <code>prgraph-mcp</code> server) or CI ask “will this change collide with an open PR?” before
          a PR exists.
        </p>
      </div>

      {fresh && (
        <div className="bg-muted space-y-2 rounded-md border p-3 text-xs" role="status">
          <p className="font-medium">Copy this token now — it will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="bg-background flex-1 truncate rounded border px-2 py-1">{fresh}</code>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Copy token"
              onClick={() => navigator.clipboard.writeText(fresh).then(() => toast.success("Token copied"))}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
          <p className="text-muted-foreground">MCP client config:</p>
          <pre className="bg-background overflow-x-auto rounded border p-2">{mcpConfig}</pre>
          <Button size="xs" variant="ghost" onClick={() => setFresh(null)}>
            Done
          </Button>
        </div>
      )}

      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name: name.trim(), scopes, expiresInDays: days ? Number(days) : undefined },
            {
              onSuccess: (r) => {
                setFresh(r.token);
                setName("");
              },
              onError: onError("Could not create token"),
            },
          );
        }}
      >
        <div>
          <Label htmlFor="token-name">Name</Label>
          <Input id="token-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-code on my laptop" required maxLength={80} />
        </div>
        <div>
          <Label htmlFor="token-exp">Expires</Label>
          <select id="token-exp" value={days} onChange={(e) => setDays(e.target.value)} className="bg-background h-8 rounded-md border px-2 text-sm">
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="">Never</option>
          </select>
        </div>
        <Button type="submit" disabled={!name.trim() || scopes.length === 0 || create.isPending}>
          <KeyRound className="size-4" /> Create token
        </Button>
        <fieldset className="flex flex-wrap gap-4 text-xs sm:col-span-3">
          <legend className="sr-only">Scopes</legend>
          {SCOPES.map((sc) => (
            <label key={sc.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={scopes.includes(sc.id)}
                onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, sc.id] : cur.filter((x) => x !== sc.id)))}
              />
              {sc.label} <code className="text-muted-foreground">{sc.id}</code>
            </label>
          ))}
        </fieldset>
      </form>

      <Separator />
      {!data?.items.length ? (
        <p className="text-muted-foreground text-sm">No tokens yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {data.items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="font-medium">{t.name}</span>
              <code className="text-muted-foreground text-xs">{t.prefix}…</code>
              <span className="text-muted-foreground text-xs">{t.scopes.join(", ")}</span>
              <span className="text-muted-foreground text-xs">
                {t.revokedAt ? "revoked" : t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "never used"}
                {t.expiresAt && !t.revokedAt ? ` · expires ${new Date(t.expiresAt).toLocaleDateString()}` : ""}
              </span>
              {!t.revokedAt && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => revoke.mutate(t.id, { onSuccess: () => toast.success("Token revoked"), onError: onError("Could not revoke") })}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
