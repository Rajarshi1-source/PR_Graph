import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { recomputeGraph } from "@/lib/graph/service";
import { redis } from "@/lib/cache/redis";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({ repoId: z.coerce.number().int().positive() });

/** Trigger a manual re-sync (rate-limited; idempotent — recomputes from current state). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await ctx.params;
  const parsed = Params.safeParse({ repoId });
  if (!parsed.success) return problem(400, "Invalid repoId");

  const session = getSession(req);
  if (!session) return problem(401, "Not authenticated");

  const repo = await prisma.repository.findFirst({
    where: { id: parsed.data.repoId, installation: { userId: session.userId } },
    select: { id: true },
  });
  if (!repo) return problem(404, "Repo not connected");

  // Simple rate limit: 5/min per repo (security-and-api.md §A.6).
  const rlKey = `ratelimit:sync:${repo.id}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, 60);
  if (count > 5) return problem(429, "Too many sync requests; try again shortly");

  const result = await recomputeGraph({ repoId: repo.id, triggeredBy: "manual_sync" });
  if (!result) return problem(404, "Repo not found");

  return NextResponse.json({ ok: true, stats: result.graph.stats, computeTimeMs: result.computeTimeMs });
}
