import { redis } from "@/lib/cache/redis";
import { env } from "@/lib/env";
import { aiBudgetRemaining } from "@/lib/metrics";

/**
 * Daily LLM budget breaker (prgraph-graph-ai MLOps wrapper). Spend accrues in a per-UTC-day Redis
 * counter; once it reaches `LLM_DAILY_BUDGET_USD` the analyzer degrades to the heuristic until the
 * next day. A budget of 0 means "unlimited" (no breaker).
 */
const SPEND_TTL_SECONDS = 60 * 60 * 48; // keep two days for visibility

const dayKey = () => `ai:cost:${new Date().toISOString().slice(0, 10)}`;

export async function recordSpend(usd: number): Promise<void> {
  if (usd <= 0) return;
  const key = dayKey();
  const total = Number(await redis.incrbyfloat(key, usd));
  await redis.expire(key, SPEND_TTL_SECONDS);
  if (env.LLM_DAILY_BUDGET_USD > 0) {
    aiBudgetRemaining.set(Math.max(0, env.LLM_DAILY_BUDGET_USD - total));
  }
}

export async function spentTodayUsd(): Promise<number> {
  const v = await redis.get(dayKey());
  return v ? Number(v) : 0;
}

export async function budgetExceeded(): Promise<boolean> {
  if (env.LLM_DAILY_BUDGET_USD <= 0) return false; // unlimited
  const spent = await spentTodayUsd();
  aiBudgetRemaining.set(Math.max(0, env.LLM_DAILY_BUDGET_USD - spent));
  return spent >= env.LLM_DAILY_BUDGET_USD;
}
