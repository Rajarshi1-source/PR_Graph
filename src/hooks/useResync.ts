"use client";

import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { SyncResultSchema } from "@/lib/api/schemas";

/** Trigger a manual re-sync for a repo (the graph itself arrives over the socket). */
export function useResync(repoId: number) {
  return useMutation({
    mutationFn: () =>
      apiFetch(`/api/repos/${repoId}/sync`, SyncResultSchema, { method: "POST" }),
  });
}
