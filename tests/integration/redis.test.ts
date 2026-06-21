import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redis } from "@/lib/cache/redis";
import { getCachedGraph, setCachedGraph, invalidateGraph } from "@/lib/cache/graphCache";
import { enqueueWebhook, STREAM } from "@/lib/events/queue";
import type { DependencyGraph } from "@/lib/graph/types";

/**
 * Integration tests against a real Redis (provided by CI service containers / local docker-compose).
 * They exercise the cache + stream paths that unit tests mock out.
 */
const emptyGraph: DependencyGraph = {
  nodes: [],
  edges: [],
  mergeOrder: { levels: [], inCycle: [], totalLevels: 0 },
  cycles: [],
  stats: { totalPRs: 0, safePRs: 0, blockedPRs: 0, deadlockedPRs: 0, totalDependencies: 0 },
};

const TEST_REPO_ID = 999_999;

beforeAll(async () => {
  await redis.connect().catch(() => {}); // lazyConnect — ensure connected
});

afterAll(async () => {
  await invalidateGraph(TEST_REPO_ID).catch(() => {});
  await redis.del(`graph:version:${TEST_REPO_ID}`).catch(() => {});
  await redis.quit().catch(() => {});
});

describe("graph cache (Redis)", () => {
  it("round-trips a graph and bumps the version", async () => {
    const v = await setCachedGraph(TEST_REPO_ID, emptyGraph);
    expect(v).toBeGreaterThan(0);

    const hit = await getCachedGraph(TEST_REPO_ID);
    expect(hit).toEqual(emptyGraph);

    await invalidateGraph(TEST_REPO_ID);
    expect(await getCachedGraph(TEST_REPO_ID)).toBeNull();
  });
});

describe("webhook queue (Redis Streams)", () => {
  it("appends an event to the stream", async () => {
    const before = await redis.xlen(STREAM);
    const id = await enqueueWebhook("ping", { hello: "world" });
    expect(id).toBeTruthy();
    const after = await redis.xlen(STREAM);
    expect(after).toBe(before + 1);
  });
});
