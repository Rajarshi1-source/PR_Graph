import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase-3 integration tests against REAL Postgres + Redis (CI service containers / local). GitHub
 * is mocked at the module boundary; everything else (Prisma, Redis locks, dirty sets, rate limits,
 * Check Run bookkeeping) is real.
 */

// ── GitHub mocks ──────────────────────────────────────────────────────────────────────────────
const gh = vi.hoisted(() => ({
  fetchOpenPRs: vi.fn(),
  fetchPRFiles: vi.fn(),
  checksCreate: vi.fn(),
  checksUpdate: vi.fn(),
  gate: null as null | Promise<void>,
}));

vi.mock("@/lib/github/fetchPRs", () => ({
  fetchOpenPRs: async (...args: unknown[]) => {
    if (gh.gate) await gh.gate; // lets a test hold the first recompute "in flight"
    return gh.fetchOpenPRs(...args);
  },
}));
vi.mock("@/lib/github/fetchPRFiles", () => ({ fetchPRFiles: (...a: unknown[]) => gh.fetchPRFiles(...a) }));
vi.mock("@/lib/github/readiness", () => ({
  fetchReadiness: async () => new Map(),
  readinessCacheKey: (id: number) => `gh:readiness:${id}`,
}));
vi.mock("@/lib/github/client", () => ({
  octokitFor: () => ({ rest: { checks: { create: gh.checksCreate, update: gh.checksUpdate } } }),
}));
vi.mock("@/lib/websocket/server", () => ({ pushGraphUpdate: vi.fn(), setIO: vi.fn(), getIO: () => null }));

import { prisma } from "@/lib/db/prisma";
import { redis } from "@/lib/cache/redis";
import { recomputeGraph } from "@/lib/graph/service";
import { createApiToken, requireApiToken, revokeApiToken, TOKEN_RATE_LIMIT_PER_MIN } from "@/lib/auth/apiToken";
import { publishCheckRuns } from "@/lib/bot/publishChecks";
import { buildDependencyGraph } from "@/lib/graph/buildDependencyGraph";
import { withMergePlan } from "@/lib/graph/mergePlan";

const GH_INSTALL = 990_001;
let userId = 0;
let repoId = 0;

const rawPR = (number: number, day: number) => ({
  number,
  id: 10_000 + number,
  title: `PR ${number}`,
  html_url: `https://github.com/it/repo/pull/${number}`,
  created_at: `2026-10-0${day}T00:00:00Z`,
  updated_at: `2026-10-0${day}T00:00:00Z`,
  user: { login: `dev${number}`, avatar_url: "" },
  head: { sha: `sha${number}`, ref: `pr-${number}` },
  base: { sha: "base0", ref: "main" },
});
const file = (line: number, text: string) => ({
  filename: "src/a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: `@@ -${line},1 +${line},1 @@\n-old\n+${text}`,
});

beforeAll(async () => {
  await redis.connect().catch(() => {});
  await prisma.installation.deleteMany({ where: { githubInstallId: GH_INSTALL } });
  await prisma.user.deleteMany({ where: { githubId: GH_INSTALL } });
  const user = await prisma.user.create({ data: { githubId: GH_INSTALL, username: "it-user", accessToken: "x" } });
  const inst = await prisma.installation.create({
    data: { userId: user.id, githubInstallId: GH_INSTALL, accountLogin: "it", accountType: "User" },
  });
  const repo = await prisma.repository.create({
    data: { installationId: inst.id, githubRepoId: GH_INSTALL, fullName: "it/repo", defaultBranch: "main" },
  });
  userId = user.id;
  repoId = repo.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { githubId: GH_INSTALL } }); // cascades to everything
  await redis.del(`graph:lock:${repoId}`, `graph:dirty:${repoId}`, `graph:${repoId}`, `graph:version:${repoId}`);
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

beforeEach(() => {
  gh.fetchOpenPRs.mockReset();
  gh.fetchPRFiles.mockReset();
  gh.checksCreate.mockReset();
  gh.checksUpdate.mockReset();
  gh.gate = null;
});

describe("recompute coalescing (no lost webhooks)", () => {
  it("a webhook arriving mid-recompute triggers exactly one extra run", async () => {
    gh.fetchOpenPRs.mockResolvedValue([rawPR(1, 1), rawPR(2, 2)]);
    gh.fetchPRFiles.mockImplementation(async (_ref: unknown, n: number) => [file(10, `v${n}`)]);

    let release!: () => void;
    gh.gate = new Promise<void>((r) => (release = r));
    const first = recomputeGraph({ repoId, triggeredBy: "webhook:opened:1", changedPrNumber: 1 });
    await vi.waitFor(async () => expect(await redis.exists(`graph:lock:${repoId}`)).toBe(1));

    // Two more events while the lock is held: both are recorded, neither is dropped.
    expect(await recomputeGraph({ repoId, triggeredBy: "webhook:synchronize:2", changedPrNumber: 2 })).toBeNull();
    expect(await recomputeGraph({ repoId, triggeredBy: "webhook:edited:2", changedPrNumber: 2 })).toBeNull();
    expect((await redis.smembers(`graph:dirty:${repoId}`)).sort()).toEqual(["2"]);

    gh.gate = null;
    release();
    const result = await first;

    expect(result?.graph.edges.find((e) => e.id === "1-2")).toMatchObject({ type: "BLOCKS", certainty: "exact" });
    expect(gh.fetchOpenPRs).toHaveBeenCalledTimes(2); // original pass + ONE coalesced re-run
    expect(await redis.exists(`graph:dirty:${repoId}`)).toBe(0);
    expect(await redis.exists(`graph:lock:${repoId}`)).toBe(0);

    const snaps = await prisma.graphSnapshot.findMany({ where: { repoId }, orderBy: { id: "asc" } });
    expect(snaps.map((s) => s.triggeredBy)).toEqual(["webhook:opened:1", "coalesced:1"]);
  });

  it("persists Phase-3 edge classification and PR refs", async () => {
    gh.fetchOpenPRs.mockResolvedValue([rawPR(1, 1), rawPR(2, 2)]);
    gh.fetchPRFiles.mockImplementation(async (_ref: unknown, n: number) => [file(n === 1 ? 10 : 90, `v${n}`)]);
    await recomputeGraph({ repoId, triggeredBy: "manual_sync", forceFresh: true });

    const dep = await prisma.dependency.findFirstOrThrow({ where: { repoId } });
    expect(dep).toMatchObject({ edgeType: "TOUCHES", blocking: false, severity: "low", certainty: "exact" });
    const pr = await prisma.pullRequest.findFirstOrThrow({ where: { repoId, number: 2 } });
    expect(pr).toMatchObject({ headSha: "sha2", baseRef: "main" });
  });
});

describe("API tokens", () => {
  const req = (token: string) =>
    new NextRequest("http://localhost/api/v1/preflight", { method: "POST", headers: { authorization: `Bearer ${token}` } });

  it("authenticates by hash, enforces scope, revocation and the per-token rate limit", async () => {
    const created = await createApiToken({ userId, repoId, name: "it", scopes: ["preflight:read"] });
    expect(created).not.toBeNull();
    const { token, view } = created!;
    expect(view.prefix).toBe(token.slice(0, 8));
    const stored = await prisma.apiToken.findUniqueOrThrow({ where: { id: view.id } });
    expect(stored.tokenHash).not.toContain(token.slice(4)); // plaintext never stored

    const ok = await requireApiToken(req(token), "preflight:read");
    expect(ok.error).toBeNull();
    expect(ok.token).toMatchObject({ repoId, fullName: "it/repo" });

    const wrongScope = await requireApiToken(req(token), "graph:read");
    expect(wrongScope.error?.status).toBe(403);

    const minute = Math.floor(Date.now() / 60_000);
    await redis.set(`rl:tok:${view.id}:${minute}`, String(TOKEN_RATE_LIMIT_PER_MIN), "EX", 70);
    const limited = await requireApiToken(req(token), "preflight:read");
    expect(limited.error?.status).toBe(429);
    expect(limited.error?.headers.get("retry-after")).toBeTruthy();
    await redis.del(`rl:tok:${view.id}:${minute}`);

    expect(await revokeApiToken(repoId, view.id, userId)).toBe(true);
    expect((await requireApiToken(req(token), "preflight:read")).error?.status).toBe(401);
  });
});

describe("Check Run publisher idempotency", () => {
  it("writes once, skips unchanged content, updates on change", async () => {
    gh.checksCreate.mockImplementation(async () => ({ data: { id: Math.floor(Math.random() * 1e9) } }));
    gh.checksUpdate.mockResolvedValue({ data: {} });
    const ref = { id: repoId, owner: "it", name: "repo", installationId: GH_INSTALL };
    const pr = (n: number, line: number) => ({
      number: n,
      title: `PR ${n}`,
      author: "a",
      createdAt: `2026-10-0${n}T00:00:00Z`,
      htmlUrl: "",
      headSha: `cr-sha${n}`,
      files: [{ filename: "a.ts", additions: 1, deletions: 1, patch: `@@ -${line},1 +${line},1 @@\n-x\n+y${n}` }],
    });

    const g1 = withMergePlan(buildDependencyGraph([pr(1, 5), pr(2, 5)]));
    expect(await publishCheckRuns(ref, g1, { failOnConflict: false })).toEqual({ written: 2, skipped: 0 });
    expect(gh.checksCreate).toHaveBeenCalledTimes(2);

    expect(await publishCheckRuns(ref, g1, { failOnConflict: false })).toEqual({ written: 0, skipped: 2 });

    const g2 = withMergePlan(buildDependencyGraph([pr(1, 5), pr(2, 80)])); // conflict resolved
    const r3 = await publishCheckRuns(ref, g2, { failOnConflict: false });
    expect(r3.written).toBe(2);
    expect(gh.checksUpdate).toHaveBeenCalledTimes(2);
    expect(gh.checksCreate).toHaveBeenCalledTimes(2); // same head SHAs → update, not create
  });
});
