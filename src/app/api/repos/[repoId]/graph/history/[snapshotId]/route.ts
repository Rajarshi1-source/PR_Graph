import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { getSnapshotDiff } from "@/lib/graph/service";
import { problem, problemFromZod } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({
  repoId: z.coerce.number().int().positive(),
  snapshotId: z.coerce.number().int().positive(),
});

/** One snapshot + what changed since the previous one (history / diff view). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string; snapshotId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid ids");
  const result = await getSnapshotDiff(parsed.data.repoId, session.userId, parsed.data.snapshotId);
  if (!result) return problem(404, "Snapshot not found");
  // Snapshots are immutable — cache privately.
  return NextResponse.json(result, { headers: { "cache-control": "private, max-age=300" } });
}
