import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { redis } from "@/lib/cache/redis";
import { readJsonBody } from "@/lib/http/body";
import { problem, problemFromZod } from "@/lib/http/problem";
import { PreflightBody } from "@/lib/preflight/schema";
import { preflight } from "@/lib/graph/preflight";
import { buildDemoGraph, demoPRs, DEMO_REPO } from "@/lib/demo/fixtures";
import { preflightRequests } from "@/lib/metrics";

export const runtime = "nodejs";

const MAX_BODY = 256_000;
const PER_IP_PER_MIN = 30;

/** Best-effort per-IP limit: if Redis is slow or down, the (pure, cheap) demo stays available. */
async function limited(ip: string): Promise<boolean> {
  const key = `rl:demo:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const count = await Promise.race([
    redis.incr(key).then(async (n) => {
      if (n === 1) await redis.expire(key, 70);
      return n;
    }),
    new Promise<number>((resolve) => setTimeout(() => resolve(0), 300)),
  ]).catch(() => 0);
  return count > PER_IP_PER_MIN;
}

/**
 * Public preflight against the static demo repo (security-and-api.md §A.10). Pure compute over
 * fixtures — no DB, no GitHub, no user data. Gated by DEMO_ENABLED.
 */
export async function POST(req: NextRequest) {
  if (!env.DEMO_ENABLED) return problem(404, "Demo disabled");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (await limited(ip)) return problem(429, "Too many demo requests; try again in a minute");

  const body = await readJsonBody(req, MAX_BODY);
  if (body.error) return body.error;
  const parsed = PreflightBody.safeParse({ repo: DEMO_REPO, ...(body.data as object) });
  if (!parsed.success) return problemFromZod(parsed.error, "Invalid preflight request");

  const graph = buildDemoGraph();
  const status = new Map(graph.nodes.map((n) => [n.data.prNumber, n.data.status]));
  const result = preflight(demoPRs, parsed.data, { statusOf: (n) => status.get(n) });
  preflightRequests.inc({ risk: result.risk, source: "demo" });
  return NextResponse.json({ ...result, graphVersion: 0 }, { headers: { "cache-control": "no-store" } });
}
