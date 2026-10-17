"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import {
  ApiTokenCreatedSchema,
  ApiTokenListSchema,
  RepoSettingsResponseSchema,
  type RepoSettingsDTO,
} from "@/lib/api/schemas";

const settingsKey = (repoId: number) => ["repo-settings", repoId] as const;
const tokensKey = (repoId: number) => ["repo-tokens", repoId] as const;

export function useRepoSettings(repoId: number) {
  return useQuery({
    queryKey: settingsKey(repoId),
    queryFn: () => apiFetch(`/api/repos/${repoId}/settings`, RepoSettingsResponseSchema),
  });
}

export function useUpdateRepoSettings(repoId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<RepoSettingsDTO>) =>
      apiFetch(`/api/repos/${repoId}/settings`, RepoSettingsResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => qc.setQueryData(settingsKey(repoId), data),
  });
}

export function useApiTokens(repoId: number) {
  return useQuery({
    queryKey: tokensKey(repoId),
    queryFn: () => apiFetch(`/api/repos/${repoId}/tokens`, ApiTokenListSchema),
  });
}

export function useCreateApiToken(repoId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; scopes: string[]; expiresInDays?: number }) =>
      apiFetch(`/api/repos/${repoId}/tokens`, ApiTokenCreatedSchema, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tokensKey(repoId) }),
  });
}

export function useRevokeApiToken(repoId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: number) => apiFetch(`/api/repos/${repoId}/tokens/${tokenId}`, z.null(), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tokensKey(repoId) }),
  });
}
