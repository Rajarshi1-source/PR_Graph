import { redis } from "@/lib/cache/redis";
import { prisma } from "@/lib/db/prisma";
import { STREAM, GROUP, DLQ } from "./queue";
import { recomputeGraph } from "@/lib/graph/service";
import {
  handleInstallationWebhook,
  handleInstallationReposWebhook,
} from "@/lib/github/installations";
import { webhookLatency, dlqDepth } from "@/lib/metrics";

const MAX_RETRIES = 5;
const RECLAIM_IDLE_MS = 30_000; // a failed (unacked) message becomes eligible for retry after 30s

interface WebhookJob {
  event: string;
  ts?: number;
  payload: {
    action?: string;
    repository?: { full_name?: string; id?: number };
    installation?: { id?: number; account?: { login?: string; type?: string } };
    pull_request?: { number?: number };
    sender?: { id?: number };
  };
}

/**
 * Stream consumer: at-least-once delivery via a Redis consumer group. XACK only on success;
 * after MAX_RETRIES a poison message is moved to the DLQ so it can't wedge the consumer.
 */
export async function runWorker(consumer: string): Promise<void> {
  await redis.xgroup("CREATE", STREAM, GROUP, "$", "MKSTREAM").catch(() => {}); // idempotent
  console.log(`[worker] ${consumer} consuming ${STREAM}`);

  for (;;) {
    // 1. Process brand-new messages (blocks up to 5s).
    let res: unknown;
    try {
      res = await redis.xreadgroup(
        "GROUP",
        GROUP,
        consumer,
        "COUNT",
        5,
        "BLOCK",
        5000,
        "STREAMS",
        STREAM,
        ">",
      );
    } catch (err) {
      console.error("[worker] xreadgroup error:", err);
      await sleep(1000);
      continue;
    }

    if (res) {
      const streams = res as [string, [string, string[]][]][];
      for (const [, entries] of streams) {
        for (const [id, fields] of entries) await processEntry(id, fields);
      }
    }

    // 2. Reclaim messages that failed earlier (unacked + idle): this is what actually drives
    //    retries and, after MAX_RETRIES, the DLQ. Without it, failed messages sit in the PEL
    //    forever (XREADGROUP ">" only ever returns NEW messages).
    await reclaimPending(consumer);
  }
}

/** Reclaim idle pending messages with XAUTOCLAIM and reprocess them (increments delivery count). */
async function reclaimPending(consumer: string): Promise<void> {
  let cursor = "0";
  for (let i = 0; i < 10; i++) {
    let claimed: unknown;
    try {
      claimed = await redis.xautoclaim(
        STREAM,
        GROUP,
        consumer,
        RECLAIM_IDLE_MS,
        cursor,
        "COUNT",
        10,
      );
    } catch (err) {
      console.error("[worker] xautoclaim error:", err);
      return;
    }
    // Redis 7 returns [nextCursor, [[id, fields], ...], [deletedIds]].
    const [next, entries] = claimed as [string, [string, string[]][], string[]];
    for (const [id, fields] of entries ?? []) await processEntry(id, fields);
    cursor = next;
    if (cursor === "0" || !entries || entries.length === 0) break;
  }
}

/** Process one stream entry: ack on success; on failure leave pending (retry) or DLQ if exhausted. */
async function processEntry(id: string, fields: string[]): Promise<void> {
  try {
    await handleJob(parseFields(fields));
    await redis.xack(STREAM, GROUP, id);
  } catch (err) {
    const deliveries = await retryCount(id);
    if (deliveries >= MAX_RETRIES) {
      await redis.xadd(DLQ, "*", "id", id, "error", String(err), "fields", JSON.stringify(fields));
      await redis.xack(STREAM, GROUP, id); // remove from PEL so it stops being reclaimed
      try {
        dlqDepth.set(await redis.xlen(DLQ));
      } catch {
        /* metric best-effort */
      }
      console.error(`[worker] message ${id} → DLQ after ${deliveries} tries:`, err);
    } else {
      // Leave it pending (no XACK): reclaimPending will retry it after RECLAIM_IDLE_MS.
      console.warn(`[worker] message ${id} failed (delivery ${deliveries}); will retry:`, err);
    }
  }
}

async function handleJob(job: WebhookJob): Promise<void> {
  switch (job.event) {
    case "pull_request":
      return handlePullRequest(job);
    case "installation":
      return handleInstallationWebhook(job.payload);
    case "installation_repositories":
      return handleInstallationReposWebhook(job.payload);
    default:
      return; // ignored event type
  }
}

async function handlePullRequest(job: WebhookJob): Promise<void> {
  const fullName = job.payload.repository?.full_name;
  if (!fullName) return;

  const repo = await prisma.repository.findFirst({ where: { fullName }, select: { id: true } });
  if (!repo) return; // not a connected repo

  const action = job.payload.action ?? "unknown";
  const prNumber = job.payload.pull_request?.number;
  await recomputeGraph({
    repoId: repo.id,
    triggeredBy: `webhook:${action}${prNumber ? `:${prNumber}` : ""}`,
    changedPrNumber: prNumber,
  });

  // End-to-end latency: webhook received (enqueue ts) → recompute complete.
  if (job.ts) webhookLatency.observe(Date.now() - job.ts);
}

function parseFields(fields: string[]): WebhookJob {
  const map = new Map<string, string>();
  for (let i = 0; i < fields.length; i += 2) map.set(fields[i], fields[i + 1]);
  const ts = map.get("ts");
  return {
    event: map.get("event") ?? "",
    ts: ts ? Number(ts) : undefined,
    payload: JSON.parse(map.get("payload") ?? "{}"),
  };
}

async function retryCount(id: string): Promise<number> {
  // XPENDING extended form for a single id: [[id, consumer, idleMs, deliveryCount]].
  const info = (await redis.xpending(STREAM, GROUP, id, id, 1)) as
    | [string, string, number, number][]
    | null;
  return info && info.length ? info[0][3] : 1;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
