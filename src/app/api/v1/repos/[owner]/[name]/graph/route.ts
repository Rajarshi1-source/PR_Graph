import { NextResponse, type NextRequest } from "next/server";
import { requireApiToken } from "@/lib/auth/apiToken";
import { getCurrentGraph } from "@/lib/graph/service";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/** Current dependency graph for MCP / CI clients (Bearer token with `graph:read`). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const { token, error } = await requireApiToken(req, "graph:read");
  if (error) return error;
  const { owner, name } = await ctx.params;
  if (`${owner}/${name}`.toLowerCase() !== token.fullName.toLowerCase()) {
    return problem(403, "This token is not valid for that repository");
  }
  const graph = await getCurrentGraph(token.repoId);
  if (!graph) return problem(404, "No graph computed yet");
  return NextResponse.json(graph, { headers: { "cache-control": "private, max-age=5" } });
}
