import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { seal } from "@/lib/crypto/secretbox";
import { verifyState } from "@/lib/slack/state";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

interface SlackOAuthResponse {
  ok: boolean;
  access_token?: string;
  team?: { id: string; name: string };
  error?: string;
}

/** Slack OAuth callback: exchange the code, store the bot token for the repo. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = verifyState(req.nextUrl.searchParams.get("state"));
  if (!code) return problem(400, "Missing code");
  if (!state) return problem(400, "Invalid or expired state");

  const repo = await prisma.repository.findUnique({
    where: { id: state.repoId },
    select: { id: true, fullName: true },
  });
  if (!repo) return problem(404, "Repo not found");

  const body = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID ?? "",
    client_secret: env.SLACK_CLIENT_SECRET ?? "",
    code,
    redirect_uri: `${env.APP_URL}/api/slack/callback`,
  });
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as SlackOAuthResponse;
  if (!data.ok || !data.access_token || !data.team) {
    return problem(502, `Slack OAuth failed: ${data.error ?? "unknown"}`);
  }

  await prisma.slackConfig.upsert({
    where: { repoId: repo.id },
    create: {
      repoId: repo.id,
      teamId: data.team.id,
      channelId: "",
      channelName: "",
      botToken: seal(data.access_token),
      isActive: false, // becomes active once a channel is chosen in settings
    },
    update: {
      teamId: data.team.id,
      botToken: seal(data.access_token),
    },
  });

  const [owner, name] = repo.fullName.split("/");
  return NextResponse.redirect(new URL(`/repo/${owner}/${name}/settings`, env.APP_URL));
}
