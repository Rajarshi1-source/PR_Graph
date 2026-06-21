import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { getGraphHistory } from "@/lib/graph/service";
import { problem, problemFromZod } from "@/lib/http/problem";

export const runtime = "nodejs";

const Schema = z.object({
  repoId: z.coerce.number().int().positive(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

/** Snapshot history (change tracking) for a repo. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;

  const { repoId } = await ctx.params;
  const parsed = Schema.safeParse({
    repoId,
    page: req.nextUrl.searchParams.get("page") ?? undefined,
    perPage: req.nextUrl.searchParams.get("perPage") ?? undefined,
  });
  if (!parsed.success) return problemFromZod(parsed.error);

  const result = await getGraphHistory(
    parsed.data.repoId,
    session.userId,
    parsed.data.page,
    parsed.data.perPage,
  );
  if (!result) return problem(404, "Repo not connected");

  return NextResponse.json(result);
}
