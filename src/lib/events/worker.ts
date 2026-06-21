import { redis } from "@/lib/cache/redis";
import { prisma } from "@/lib/db/prisma";
import { STREAM, GROUP, DLQ } from "./queue";
import { recomputeGraph } from "@/lib/graph/service";

const MAX_RETRIES = 5;

interface WebhookJob {
  event: string;
  payload: {
    action?: string;
    repository?: { full_name?: string; id?: number };
    installation?: { id?: number };
    pull_request?: { number?: number };
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
    if (!res) continue;

    const streams = res as [string, [string, string[]][]][];
    for (const [, entries] of streams) {
      for (const [id, fields] of entries) {
        try {
          const job = parseFields(fields);
          await handleJob(job);
          await redis.xack(STREAM, GROUP, id);
        } catch (err) {
          const deliveries = await retryCount(id);
          if (deliveries >= MAX_RETRIES) {
            await redis.xadd(DLQ, "*", "id", id, "error", String(err));
            await redis.xack(STREAM, GROUP, id); // remove from pending
            console.error(`[worker] message ${id} → DLQ after ${deliveries} tries:`, err);
          } else {
            console.warn(`[worker] message ${id} failed (try ${deliveries}); will retry:`, err);
          }
        }
      }
    }
  }
}

async function handleJob(job: WebhookJob): Promise<void> {
  // Only PR-affecting events trigger a recompute.
  if (job.event !== "pull_request") return;
  const fullName = job.payload.repository?.full_name;
  if (!fullName) return;

  const repo = await prisma.repository.findFirst({ where: { fullName }, select: { id: true } });
  if (!repo) return; // not a connected repo

  const action = job.payload.action ?? "unknown";
  const prNumber = job.payload.pull_request?.number;
  await recomputeGraph({
    repoId: repo.id,
    triggeredBy: `webhook:${action}${prNumber ? `:${prNumber}` : ""}`,
  });
}

function parseFields(fields: string[]): WebhookJob {
  const map = new Map<string, string>();
  for (let i = 0; i < fields.length; i += 2) map.set(fields[i], fields[i + 1]);
  return {
    event: map.get("event") ?? "",
    payload: JSON.parse(map.get("payload") ?? "{}"),
  };
}

async function retryCount(id: string): Promise<number> {
  // XPENDING for this id returns delivery count.
  const info = (await redis.xpending(STREAM, GROUP, "IDLE", 0, id, id, 1)) as
    | [string, string, number, number][]
    | null;
  return info && info.length ? info[0][3] : 1;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
