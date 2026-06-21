"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useSlackConfig,
  useUpdateSlackConfig,
  useDisconnectSlack,
} from "@/hooks/useSlackConfig";
import { ApiError } from "@/lib/api/client";

const ChannelForm = z.object({
  channelId: z.string().min(1, "Channel ID is required"),
  channelName: z.string().optional(),
});
type ChannelForm = z.infer<typeof ChannelForm>;

export function SlackSettings({ repoId }: { repoId: number }) {
  const { data: state, isPending } = useSlackConfig(repoId);
  const update = useUpdateSlackConfig(repoId);
  const disconnect = useDisconnectSlack(repoId);

  const form = useForm<ChannelForm>({
    resolver: zodResolver(ChannelForm),
    defaultValues: { channelId: "", channelName: "" },
  });

  // Sync the form with the loaded config (after the query resolves / repo changes).
  useEffect(() => {
    if (state?.connected) {
      form.reset({ channelId: state.channelId ?? "", channelName: state.channelName ?? "" });
    }
  }, [state, form]);

  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : "Could not save Slack settings");

  const saveChannel = form.handleSubmit((values) => {
    update.mutate(
      { channelId: values.channelId, channelName: values.channelName, isActive: true },
      { onSuccess: () => toast.success("Slack settings saved"), onError },
    );
  });

  const toggle = (patch: Parameters<typeof update.mutate>[0]) =>
    update.mutate(patch, { onError });

  if (isPending) return <Card className="p-6 text-sm">Loading…</Card>;

  if (!state?.connected) {
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            disconnect.mutate(undefined, {
              onSuccess: () => toast.success("Slack disconnected"),
              onError,
            })
          }
        >
          Disconnect
        </Button>
      </div>

      <form onSubmit={saveChannel} className="grid gap-2">
        <Label htmlFor="channelId">Channel ID</Label>
        <Input id="channelId" placeholder="C0123456789" {...form.register("channelId")} />
        {form.formState.errors.channelId && (
          <p className="text-destructive text-xs">{form.formState.errors.channelId.message}</p>
        )}

        <Label htmlFor="channelName">Channel name (display only)</Label>
        <Input
          id="channelName"
          placeholder="#eng-pull-requests"
          {...form.register("channelName")}
        />

        <Button type="submit" className="mt-1 w-fit" disabled={update.isPending}>
          Save channel
        </Button>
      </form>

      <Separator />

      <ToggleRow
        label="Notify when PRs become unblocked"
        checked={state.notifyOnUnblock ?? true}
        onChange={(v) => toggle({ notifyOnUnblock: v })}
      />
      <ToggleRow
        label="Notify on merges"
        checked={state.notifyOnMerge ?? true}
        onChange={(v) => toggle({ notifyOnMerge: v })}
      />
      <ToggleRow
        label="Integration active"
        checked={state.isActive ?? false}
        onChange={(v) => toggle({ isActive: v })}
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
