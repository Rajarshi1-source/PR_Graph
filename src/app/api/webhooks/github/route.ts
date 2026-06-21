import { type NextRequest } from "next/server";
import { verifyGithubSignature } from "@/lib/github/verifyWebhook";
import { redis } from "@/lib/cache/redis";
import { enqueueWebhook } from "@/lib/events/queue";
import { webhooksReceived } from "@/lib/metrics";
import { problem } from "@/lib/http/problem";

export const runtime = "nodejs";

/**
 * GitHub webhook receiver: verify HMAC on the RAW body → dedupe on delivery id → XADD →
 * return 202 fast (<1s). The heavy recompute runs in the worker (security-and-api.md §A.3, §B.5).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text(); // RAW body — required for HMAC
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!verifyGithubSignature(raw, sig)) return problem(401, "Bad signature");

  const deliveryId = req.headers.get("x-github-delivery") ?? "";
  const first = await redis.set(`webhook:dedup:${deliveryId}`, "1", "EX", 300, "NX");
  if (first === null) return new Response(null, { status: 202 }); // duplicate → ack, skip

  const event = req.headers.get("x-github-event") ?? "";
  webhooksReceived.inc({ event });
  await enqueueWebhook(event, JSON.parse(raw));
  return new Response(null, { status: 202 });
}
