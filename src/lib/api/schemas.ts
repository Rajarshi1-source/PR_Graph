import { z } from "zod";

/**
 * Shared API contract schemas (frontend skill: one Zod source for client + server). Client
 * hooks parse responses through these so a backend shape drift surfaces as a typed error.
 */
export const SlackConfigSchema = z.object({
  connected: z.boolean(),
  teamId: z.string().optional(),
  channelId: z.string().optional(),
  channelName: z.string().optional(),
  isActive: z.boolean().optional(),
  notifyOnMerge: z.boolean().optional(),
  notifyOnUnblock: z.boolean().optional(),
});
export type SlackConfig = z.infer<typeof SlackConfigSchema>;

export const SlackPatchSchema = z.object({
  channelId: z.string().min(1).optional(),
  channelName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  notifyOnMerge: z.boolean().optional(),
  notifyOnUnblock: z.boolean().optional(),
});
export type SlackPatch = z.infer<typeof SlackPatchSchema>;

export const RepoListItemSchema = z.object({
  id: z.number(),
  fullName: z.string(),
  isActive: z.boolean(),
  lastSyncAt: z.string().nullable().or(z.date().nullable()),
  prCount: z.number(),
});

export const RepoListSchema = z.object({
  items: z.array(RepoListItemSchema),
  page: z.number(),
  perPage: z.number(),
  total: z.number(),
  hasNext: z.boolean(),
});
export type RepoList = z.infer<typeof RepoListSchema>;

export const GraphStatsSchema = z.object({
  totalPRs: z.number(),
  safePRs: z.number(),
  blockedPRs: z.number(),
  deadlockedPRs: z.number(),
  totalDependencies: z.number(),
});

export const SyncResultSchema = z.object({
  ok: z.boolean(),
  stats: GraphStatsSchema,
  computeTimeMs: z.number(),
});
export type SyncResult = z.infer<typeof SyncResultSchema>;
