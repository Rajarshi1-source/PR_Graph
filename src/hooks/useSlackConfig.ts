"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { SlackConfigSchema, type SlackConfig, type SlackPatch } from "@/lib/api/schemas";

const key = (repoId: number) => ["slack", repoId] as const;

/** Read the Slack integration config for a repo. */
export function useSlackConfig(repoId: number) {
  return useQuery({
    queryKey: key(repoId),
    queryFn: () => apiFetch(`/api/repos/${repoId}/slack`, SlackConfigSchema),
  });
}

/** Update the Slack config (channel + notification toggles). */
export function useUpdateSlackConfig(repoId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SlackPatch) =>
      apiFetch(`/api/repos/${repoId}/slack`, SlackConfigSchema, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (data: SlackConfig) => qc.setQueryData(key(repoId), data),
  });
}

/** Disconnect Slack for a repo. */
export function useDisconnectSlack(repoId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(`/api/repos/${repoId}/slack`, SlackConfigSchema, { method: "DELETE" }),
    onSuccess: () => qc.setQueryData(key(repoId), { connected: false }),
  });
}
