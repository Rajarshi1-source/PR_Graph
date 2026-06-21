"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

interface SlackState {
  connected: boolean;
  channelId?: string;
  channelName?: string;
  isActive?: boolean;
  notifyOnMerge?: boolean;
  notifyOnUnblock?: boolean;
}

export function SlackSettings({ repoId }: { repoId: number }) {
  const [state, setState] = useState<SlackState | null>(null);
  const [channelId, setChannelId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/repos/${repoId}/slack`)
      .then((r) => r.json())
      .then((s: SlackState) => {
        setState(s);
        setChannelId(s.channelId ?? "");
        setChannelName(s.channelName ?? "");
      })
      .catch(() => setState({ connected: false }));
  }, [repoId]);

  async function patch(body: Partial<SlackState> & { channelId?: string; channelName?: string }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/slack`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      const next = (await res.json()) as SlackState;
      setState((prev) => ({ ...(prev ?? { connected: true }), ...next }));
      toast.success("Slack settings saved");
    } catch {
      toast.error("Could not save Slack settings");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    await fetch(`/api/repos/${repoId}/slack`, { method: "DELETE" });
    setState({ connected: false });
    toast.success("Slack disconnected");
  }

  if (state === null) return <Card className="p-6 text-sm">Loading…</Card>;

  if (!state.connected) {
    return (
      <Card className="gap-3 p-6">
        <h2 className="font-semibold">Slack notifications</h2>
        <p className="text-muted-foreground text-sm">
          Connect a Slack workspace to get notified when PRs become safe to merge.
        </p>
        <Button render={<a href={`/api/slack/install?repoId=${repoId}`} />} className="w-fit">
          Connect Slack
        </Button>
      </Card>
    );
  }

  return (
    <Card className="gap-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Slack notifications</h2>
        <Button variant="ghost" size="sm" onClick={disconnect}>
          Disconnect
        </Button>
      </div>

      <div className="grid gap-2 text-sm">
        <label className="font-medium" htmlFor="channelId">
          Channel ID
        </label>
        <input
          id="channelId"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          placeholder="C0123456789"
          className="border-input bg-background h-9 rounded-md border px-3"
        />
        <label className="font-medium" htmlFor="channelName">
          Channel name (display only)
        </label>
        <input
          id="channelName"
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
          placeholder="#eng-pull-requests"
          className="border-input bg-background h-9 rounded-md border px-3"
        />
        <Button
          className="mt-1 w-fit"
          disabled={saving || !channelId}
          onClick={() => patch({ channelId, channelName, isActive: true })}
        >
          Save channel
        </Button>
      </div>

      <Separator />

      <ToggleRow
        label="Notify when PRs become unblocked"
        checked={state.notifyOnUnblock ?? true}
        onChange={(v) => patch({ notifyOnUnblock: v })}
      />
      <ToggleRow
        label="Notify on merges"
        checked={state.notifyOnMerge ?? true}
        onChange={(v) => patch({ notifyOnMerge: v })}
      />
      <ToggleRow
        label="Integration active"
        checked={state.isActive ?? false}
        onChange={(v) => patch({ isActive: v })}
      />
    </Card>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
