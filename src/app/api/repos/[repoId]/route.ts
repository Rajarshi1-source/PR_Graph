import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { deleteRepoForUser, getRepoForUser } from "@/lib/repos/service";
import { problem, problemFromZod } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({ repoId: z.coerce.number().int().positive() });

/** Repo detail for the current user. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;

  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid repoId");

  const repo = await getRepoForUser(parsed.data.repoId, session.userId);
  if (!repo) return problem(404, "Repo not connected");

  return NextResponse.json({
    id: repo.id,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    isActive: repo.isActive,
    lastSyncAt: repo.lastSyncAt,
  });
}

/** Disconnect a repo from PRGraph. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;

  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid repoId");

  const ok = await deleteRepoForUser(parsed.data.repoId, session.userId);
  if (!ok) return problem(404, "Repo not connected");

  return new NextResponse(null, { status: 204 });
}
