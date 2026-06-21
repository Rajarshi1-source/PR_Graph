import { type NextRequest } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verifySlack";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/**
 * Slack Events API endpoint: handles the one-time URL verification handshake and verifies the
 * signing secret on every request (security-and-api.md §A.4). PRGraph is outbound-only for the
 * MVP, so other events are acknowledged with 200 and ignored.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = verifySlackSignature(
    raw,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
  );
  if (!ok) return problem(401, "Bad Slack signature");

  const body = JSON.parse(raw) as { type?: string; challenge?: string };
  if (body.type === "url_verification" && body.challenge) {
    return Response.json({ challenge: body.challenge });
  }
  return new Response(null, { status: 200 });
}
