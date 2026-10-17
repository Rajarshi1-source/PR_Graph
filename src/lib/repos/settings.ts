import { z } from "zod";

/** Glob list: bounded, simple path globs only. */
const Globs = z.array(z.string().trim().min(1).max(200).regex(/^[\w.\-*/?@{},\[\]]+$/, "Invalid glob")).max(50);

/**
 * Per-repo settings stored in `Repository.settings` (JSONB). Parsing always applies defaults, so a
 * repo created before Phase 3 (settings `{}`) reads as the defaults.
 */
export const RepoSettingsSchema = z.object({
  /** Publish the `PRGraph` Check Run on every open PR. */
  botEnabled: z.boolean().default(false),
  /** Check Run concludes `failure` for BLOCKED / DEADLOCKED PRs (usable as a required check). */
  failOnConflict: z.boolean().default(false),
  /** Per-repo AI switch — can only turn AI OFF (the global AI_ENABLED must also be on). */
  aiEnabled: z.boolean().default(true),
  /** Extra regenerable globs (never block), on top of the built-in lockfile / snapshot list. */
  ignoreGlobs: Globs.default([]),
  /** Monorepo workspace globs (e.g. `apps/*`); empty = built-in detection. */
  workspaceGlobs: Globs.default([]),
});

export type RepoSettings = z.infer<typeof RepoSettingsSchema>;

/** Partial update payload for PATCH /api/repos/:id/settings. */
export const RepoSettingsPatchSchema = RepoSettingsSchema.partial().strict();

export function parseRepoSettings(json: unknown): RepoSettings {
  const parsed = RepoSettingsSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : RepoSettingsSchema.parse({});
}
