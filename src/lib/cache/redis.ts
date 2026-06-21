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

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
  globalForRedis.pub = pub;
  globalForRedis.sub = sub;
}
