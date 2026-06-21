import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { signState } from "@/lib/slack/state";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/** Begin the Slack OAuth install for a specific repo. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return problem(401, "Not authenticated");
  if (!env.SLACK_CLIENT_ID) return problem(503, "Slack integration not configured");

  const repoId = Number(req.nextUrl.searchParams.get("repoId"));
  if (!repoId) return problem(400, "Missing repoId");

  const repo = await prisma.repository.findFirst({
    where: { id: repoId, installation: { userId: session.userId } },
    select: { id: true },
  });
  if (!repo) return problem(404, "Repo not connected");

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", env.SLACK_CLIENT_ID);
  url.searchParams.set("scope", "chat:write,channels:read,groups:read");
  url.searchParams.set("redirect_uri", `${env.APP_URL}/api/slack/callback`);
  url.searchParams.set("state", signState(repo.id));
  return NextResponse.redirect(url.toString());
}
