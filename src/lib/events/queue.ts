import { redis } from "@/lib/cache/redis";

/** Redis Streams names for the webhook → recompute pipeline (backend skill). */
export const STREAM = "webhook-events";
export const GROUP = "graph-workers";
export const DLQ = "webhook-events-dlq";

/** Producer: append a webhook event to the stream. The worker consumes + recomputes. */
export async function enqueueWebhook(event: string, payload: unknown): Promise<string | null> {
  return redis.xadd(
    STREAM,
    "*",
    "event",
    event,
    "payload",
    JSON.stringify(payload),
    "ts",
    String(Date.now()),
  );
}
