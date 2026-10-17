import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { getGraphForRepo } from "@/lib/graph/service";
import { planMerges, planToMarkdown } from "@/lib/graph/mergePlan";
import { problem, problemFromZod } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({ repoId: z.coerce.number().int().positive() });
const Query = z.object({ format: z.enum(["json", "markdown"]).default("json") });

/**
 * Readiness-aware merge plan (steps of independent ready PRs, parked PRs with reasons, critical
 * path). `?format=markdown` returns the copy-paste rendering.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;

  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid repoId");
  const query = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!query.success) return problemFromZod(query.error, "Invalid query");

  const graph = await getGraphForRepo(parsed.data.repoId, session.userId);
  if (!graph) return problem(404, "Repo not connected or no graph yet");

  const plan = graph.mergePlan ?? planMerges(graph);
  if (query.data.format === "markdown") {
    return new Response(planToMarkdown(plan, graph), {
      headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "private, max-age=5" },
    });
  }
  return NextResponse.json(plan, { headers: { "cache-control": "private, max-age=5" } });
}
