import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getGraphForRepo } from "@/lib/graph/service";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({ repoId: z.coerce.number().int().positive() });

// ctx.params is a Promise in Next.js 16 — await it before validating.
export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await ctx.params;
  const parsed = Params.safeParse({ repoId });
  if (!parsed.success) return problem(400, "Invalid repoId");

  const session = getSession(req);
  if (!session) return problem(401, "Not authenticated");

  const graph = await getGraphForRepo(parsed.data.repoId, session.userId);
  if (!graph) return problem(404, "Repo not connected or no graph yet");

  return NextResponse.json(graph, { headers: { "Cache-Control": "private, max-age=5" } });
}
