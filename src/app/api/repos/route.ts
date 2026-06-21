import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { listReposForUser } from "@/lib/repos/service";
import { problemFromZod } from "@/lib/http/problem";

export const runtime = "nodejs";

const Query = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

/** List the connected repos for the current user (paginated). */
export async function GET(req: NextRequest) {
  const { session, error } = requireSession(req);
  if (error) return error;

  const parsed = Query.safeParse({
    page: req.nextUrl.searchParams.get("page") ?? undefined,
    perPage: req.nextUrl.searchParams.get("perPage") ?? undefined,
  });
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid pagination");

  const result = await listReposForUser(session.userId, parsed.data.page, parsed.data.perPage);
  return NextResponse.json(result);
}
