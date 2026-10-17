import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/requireSession";
import { getRepoForUser } from "@/lib/repos/service";
import { updateRepoSettings } from "@/lib/repos/settingsService";
import { parseRepoSettings, RepoSettingsPatchSchema } from "@/lib/repos/settings";
import { readJsonBody } from "@/lib/http/body";
import { problem, problemFromZod } from "@/lib/http/problem";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const Params = z.object({ repoId: z.coerce.number().int().positive() });

/** Repo settings with defaults applied, plus whether AI is available at all on this deployment. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid repoId");
  const repo = await getRepoForUser(parsed.data.repoId, session.userId);
  if (!repo) return problem(404, "Repo not connected");
  return NextResponse.json({ settings: parseRepoSettings(repo.settings), aiAvailable: env.AI_ENABLED });
}

/** Partial update (owner only). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { session, error } = requireSession(req);
  if (error) return error;
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid repoId");
  const body = await readJsonBody(req, 16_384);
  if (body.error) return body.error;
  const patch = RepoSettingsPatchSchema.safeParse(body.data);
  if (!patch.success) return problemFromZod(patch.error, "Invalid settings");
  const settings = await updateRepoSettings(parsed.data.repoId, session.userId, patch.data);
  if (!settings) return problem(404, "Repo not connected");
  return NextResponse.json({ settings, aiAvailable: env.AI_ENABLED });
}
