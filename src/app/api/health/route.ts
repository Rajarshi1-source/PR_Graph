import { prisma } from "@/lib/db/prisma";
import { redis } from "@/lib/cache/redis";

export const runtime = "nodejs";

/** Liveness/readiness probe — checks Postgres + Redis (security-and-api.md §B.1). */
export async function GET() {
  const checks = { db: false, redis: false };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    /* down */
  }
  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    /* down */
  }
  const ok = checks.db && checks.redis;
  return Response.json(
    { status: ok ? "ok" : "degraded", checks, ts: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
