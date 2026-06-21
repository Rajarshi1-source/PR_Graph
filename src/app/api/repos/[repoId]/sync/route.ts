import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { getRepoForUser } from "@/lib/repos/service";
import { recomputeGraph } from "@/lib/graph/service";
import { redis } from "@/lib/cache/redis";
import { problem, problemFromZod } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({ repoId: z.coerce.number().int().positive() });

/** Trigger a manual re-sync (rate-limited; idempotent — recomputes from current state). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;

  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid repoId");

  const repo = await getRepoForUser(parsed.data.repoId, session.userId);
  if (!repo) return problem(404, "Repo not connected");

  // Simple rate limit: 5/min per repo (security-and-api.md §A.6).
  const rlKey = `ratelimit:sync:${repo.id}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, 60);
  if (count > 5) return problem(429, "Too many sync requests; try again shortly");

  // Manual sync bypasses GitHub fetch caches for a fully fresh recompute.
  const result = await recomputeGraph({
    repoId: repo.id,
    triggeredBy: "manual_sync",
    forceFresh: true,
  });
  if (!result) return problem(404, "Repo not found");

  return NextResponse.json({
    ok: true,
    stats: result.graph.stats,
    computeTimeMs: result.computeTimeMs,
  });
}
