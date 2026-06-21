import Redis from "ioredis";
import { env } from "@/lib/env";

/**
 * Redis singletons (ioredis). One main connection for cache/streams plus a dedicated
 * pub/sub pair for the Socket.IO Redis adapter (pub/sub connections cannot also issue
 * regular commands). Guarded against hot-reload duplication in dev.
 */
const globalForRedis = globalThis as unknown as {
  redis?: Redis;
  pub?: Redis;
  sub?: Redis;
};

function make(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required for blocking stream reads (XREADGROUP BLOCK)
    lazyConnect: true, // connect on first command — avoids opening sockets at build/import time
  });
}

export const redis = globalForRedis.redis ?? make();
export const pub = globalForRedis.pub ?? redis.duplicate();
export const sub = globalForRedis.sub ?? redis.duplicate();

// Always attach an error listener: an unhandled ioredis "error" event crashes the process. Callers
// treat Redis as best-effort (cache ops are timeout-guarded), so connection errors are logged, not fatal.
for (const conn of [redis, pub, sub]) {
  if (conn.listenerCount("error") === 0) {
    conn.on("error", (err: Error) => {
      if (env.NODE_ENV !== "production") console.warn(`[redis] ${err.message}`);
    });
  }
}

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
  globalForRedis.pub = pub;
  globalForRedis.sub = sub;
}
