import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { getOverview } from "@/lib/repos/overview";

export const runtime = "nodejs";

/** Cross-repo health for the signed-in user (multi-repo view). */
export async function GET(req: NextRequest) {
  const { session, error } = requireSession(req);
  if (error) return error;
  return NextResponse.json(await getOverview(session.userId), { headers: { "cache-control": "private, max-age=15" } });
}
