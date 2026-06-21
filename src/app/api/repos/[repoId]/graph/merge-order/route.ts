import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { getGraphForRepo } from "@/lib/graph/service";
import { problem, problemFromZod } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({ repoId: z.coerce.number().int().positive() });

/** The topological merge order (Kahn levels) for a repo's current graph. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;

  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid repoId");

  const graph = await getGraphForRepo(parsed.data.repoId, session.userId);
  if (!graph) return problem(404, "Repo not connected or no graph yet");

  return NextResponse.json(graph.mergeOrder);
}
