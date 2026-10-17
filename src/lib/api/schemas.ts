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
  atRiskPRs: z.number().optional(),
  blockedPRs: z.number(),
  deadlockedPRs: z.number(),
  totalDependencies: z.number(),
  blockingDependencies: z.number().optional(),
});

export const SyncResultSchema = z.object({
  ok: z.boolean(),
  stats: GraphStatsSchema,
  computeTimeMs: z.number(),
});
export type SyncResult = z.infer<typeof SyncResultSchema>;

// ── Phase 3 ────────────────────────────────────────────────────────────────────────────────────

export const RepoSettingsSchema = z.object({
  botEnabled: z.boolean(),
  failOnConflict: z.boolean(),
  aiEnabled: z.boolean(),
  ignoreGlobs: z.array(z.string()),
  workspaceGlobs: z.array(z.string()),
});
export type RepoSettingsDTO = z.infer<typeof RepoSettingsSchema>;

export const RepoSettingsResponseSchema = z.object({
  settings: RepoSettingsSchema,
  aiAvailable: z.boolean(),
});

const dateish = z.string().nullable();

export const ApiTokenSchema = z.object({
  id: z.number(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: dateish,
  expiresAt: dateish,
  revokedAt: dateish,
  createdAt: z.string(),
});
export type ApiTokenDTO = z.infer<typeof ApiTokenSchema>;

export const ApiTokenListSchema = z.object({ items: z.array(ApiTokenSchema) });
export const ApiTokenCreatedSchema = z.object({ token: z.string(), view: ApiTokenSchema });

export const SnapshotSummarySchema = z.object({
  id: z.number(),
  totalPRs: z.number(),
  safePRs: z.number(),
  blockedPRs: z.number(),
  deadlockedPRs: z.number(),
  totalEdges: z.number(),
  triggeredBy: z.string(),
  computeTimeMs: z.number(),
  createdAt: z.string(),
});

const StatusChangeSchema = z.object({
  id: z.string(),
  prNumber: z.number(),
  title: z.string(),
  from: z.string(),
  to: z.string(),
});

export const SnapshotDiffSchema = z.object({
  snapshot: SnapshotSummarySchema,
  previousId: z.number().nullable(),
  diff: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    statusChanges: z.array(StatusChangeSchema),
    newlyUnblocked: z.array(StatusChangeSchema),
  }),
});
export type SnapshotDiff = z.infer<typeof SnapshotDiffSchema>;
