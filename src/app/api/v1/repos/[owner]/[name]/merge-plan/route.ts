import { NextResponse, type NextRequest } from "next/server";
import { requireApiToken } from "@/lib/auth/apiToken";
import { getCurrentGraph } from "@/lib/graph/service";
import { planMerges, planToMarkdown } from "@/lib/graph/mergePlan";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/** Merge plan for MCP / CI clients (Bearer token with `graph:read`). `?format=markdown` supported. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const { token, error } = await requireApiToken(req, "graph:read");
  if (error) return error;
  const { owner, name } = await ctx.params;
  if (`${owner}/${name}`.toLowerCase() !== token.fullName.toLowerCase()) {
    return problem(403, "This token is not valid for that repository");
  }
  const graph = await getCurrentGraph(token.repoId);
  if (!graph) return problem(404, "No graph computed yet");
  const plan = graph.mergePlan ?? planMerges(graph);
  if (req.nextUrl.searchParams.get("format") === "markdown") {
    return new Response(planToMarkdown(plan, graph, token.fullName), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }
  return NextResponse.json(plan);
}
