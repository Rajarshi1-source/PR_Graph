import { register } from "@/lib/metrics";

export const runtime = "nodejs";

/** Prometheus scrape endpoint (plan §16). */
export async function GET() {
  const body = await register.metrics();
  return new Response(body, {
    status: 200,
    headers: { "content-type": register.contentType },
  });
}
