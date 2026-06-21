import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

const Params = z.object({ repoId: z.coerce.number().int().positive() });

const PatchBody = z.object({
  channelId: z.string().min(1).optional(),
  channelName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  notifyOnMerge: z.boolean().optional(),
  notifyOnUnblock: z.boolean().optional(),
});

async function authorize(req: NextRequest, repoIdRaw: string) {
  const parsed = Params.safeParse({ repoId: repoIdRaw });
  if (!parsed.success) return { error: problem(400, "Invalid repoId") as NextResponse };
  const session = getSession(req);
  if (!session) return { error: problem(401, "Not authenticated") as NextResponse };
  const repo = await prisma.repository.findFirst({
    where: { id: parsed.data.repoId, installation: { userId: session.userId } },
    select: { id: true },
  });
  if (!repo) return { error: problem(404, "Repo not connected") as NextResponse };
  return { repoId: repo.id };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await ctx.params;
  const auth = await authorize(req, repoId);
  if ("error" in auth) return auth.error;

  const config = await prisma.slackConfig.findUnique({ where: { repoId: auth.repoId } });
  if (!config) return NextResponse.json({ connected: false });

  return NextResponse.json({
    connected: true,
    teamId: config.teamId,
    channelId: config.channelId,
    channelName: config.channelName,
    isActive: config.isActive,
    notifyOnMerge: config.notifyOnMerge,
    notifyOnUnblock: config.notifyOnUnblock,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await ctx.params;
  const auth = await authorize(req, repoId);
  if ("error" in auth) return auth.error;

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return problem(422, "Invalid body");

  const existing = await prisma.slackConfig.findUnique({ where: { repoId: auth.repoId } });
  if (!existing) return problem(404, "Slack not connected for this repo");

  const updated = await prisma.slackConfig.update({
    where: { repoId: auth.repoId },
    data: parsed.data,
  });
  return NextResponse.json({
    connected: true,
    channelId: updated.channelId,
    channelName: updated.channelName,
    isActive: updated.isActive,
    notifyOnMerge: updated.notifyOnMerge,
    notifyOnUnblock: updated.notifyOnUnblock,
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await ctx.params;
  const auth = await authorize(req, repoId);
  if ("error" in auth) return auth.error;

  await prisma.slackConfig.deleteMany({ where: { repoId: auth.repoId } });
  return NextResponse.json({ connected: false });
}
