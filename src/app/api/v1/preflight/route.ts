import { NextResponse, type NextRequest } from "next/server";
import { requireApiToken } from "@/lib/auth/apiToken";
import { readJsonBody } from "@/lib/http/body";
import { problem, problemFromZod } from "@/lib/http/problem";
import { PreflightBody, MAX_PREFLIGHT_PATCH } from "@/lib/preflight/schema";
import { runPreflight } from "@/lib/preflight/service";

export const runtime = "nodejs";

/**
 * Agent / CI preflight (security-and-api.md §B.1): "will this change collide with any open PR?"
 * Bearer token with `preflight:read`, bound to the repo named in the body.
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireApiToken(req, "preflight:read");
  if (error) return error;

  const body = await readJsonBody(req, MAX_PREFLIGHT_PATCH + 64_000);
  if (body.error) return body.error;
  const parsed = PreflightBody.safeParse(body.data);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid preflight request");
  if (parsed.data.repo.toLowerCase() !== token.fullName.toLowerCase()) {
    return problem(403, "This token is not valid for that repository");
  }

  const result = await runPreflight(token.repoId, parsed.data);
  if (!result) return problem(404, "Repository not connected");
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
