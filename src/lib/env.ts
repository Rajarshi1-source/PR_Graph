import { z } from "zod";

/**
 * Single source of truth for configuration. Validated once at module load so the
 * process fails fast on misconfiguration (backend skill rule). Integration secrets
 * are optional in development so the app boots without a full GitHub/Slack setup;
 * in production the required set is enforced.
 */
// Strict in production AT RUNTIME, but relaxed during `next build` (secrets aren't present at
// build time) so importing server modules to collect page data doesn't throw.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const isProd = process.env.NODE_ENV === "production" && !isBuildPhase;
const req = <T extends z.ZodTypeAny>(schema: T, devDefault?: z.input<T>) =>
  isProd ? schema : devDefault === undefined ? schema.optional() : schema.default(devDefault as never);

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3000),

  // Core infrastructure — defaulted to local docker-compose services in dev.
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://prgraph:prgraph@localhost:5432/prgraph?schema=public"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // Session / crypto.
  SESSION_SECRET: req(z.string().min(32), "dev-session-secret-change-me-0123456789"),
  ENCRYPTION_KEY: z.string().optional(), // base64-encoded 32 bytes; required to seal stored tokens

  // GitHub App + OAuth.
  GITHUB_APP_ID: req(z.string()),
  GITHUB_APP_PRIVATE_KEY: req(z.string()),
  GITHUB_WEBHOOK_SECRET: req(z.string().min(16)),
  GITHUB_CLIENT_ID: req(z.string()),
  GITHUB_CLIENT_SECRET: req(z.string()),
  // App slug (the URL handle, e.g. "prgraph") used to build the install link. Optional.
  GITHUB_APP_SLUG: z.string().optional(),

  // Slack (optional integration).
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // AI semantic-conflict layer (Phase 2 — disabled by default; heuristic fallback).
  AI_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LLM_PROVIDER: z.string().default("openai:gpt-5.4-mini"),
  OPENAI_API_KEY: z.string().optional(),
  LLM_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(5),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(z.treeifyError(parsed.error));
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export type Env = typeof env;
