import { describe, it, expect, vi } from "vitest";
import { formatPreflight, formatPrConflicts, formatBlocked } from "./format";
import { PrgraphClient, PrgraphError, type GraphPayload, type PreflightResponse } from "./client";
import { repoFromRemote } from "./git";

const high: PreflightResponse = {
  risk: "high",
  waitFor: [42],
  recommendation: "Wait for #42 to merge, then rebase.",
  collisions: [
    {
      pr: { number: 42, title: "Harden token check", url: "https://github.com/a/b/pull/42", author: "ana", status: "SAFE" },
      kind: "BLOCKS",
      direction: "wait",
      blocking: true,
      files: ["src/auth.ts"],
      regions: [{ file: "src/auth.ts", baseStart: 40, baseEnd: 42 }],
      symbols: [],
    },
  ],
};

const graph: GraphPayload = {
  nodes: [
    { id: "1", data: { prNumber: 1, title: "A", author: "x", status: "SAFE", htmlUrl: "", blockedBy: [], blocking: ["2"] } },
    { id: "2", data: { prNumber: 2, title: "B", author: "y", status: "BLOCKED", htmlUrl: "", blockedBy: ["1"], blocking: [] } },
  ],
  edges: [
    {
      source: "1",
      target: "2",
      type: "BLOCKS",
      blocking: true,
      sharedFiles: ["a.ts"],
      conflicts: [{ file: "a.ts", kind: "overlap", regions: [{ baseStart: 3, baseEnd: 3 }] }],
      resolution: "Merge #1 first",
    },
  ],
  stats: {},
};

describe("formatters", () => {
  it("formats a high-risk preflight with lines and recommendation", () => {
    const out = formatPreflight(high, "a/b");
    expect(out).toContain("HIGH risk");
    expect(out).toContain('#42 "Harden token check" by @ana [SAFE] edits the same lines (blocking)');
    expect(out).toContain("src/auth.ts L40-42");
    expect(out).toContain("Wait for #42");
  });
  it("formats no-risk preflight", () => {
    expect(formatPreflight({ risk: "none", collisions: [], waitFor: [], recommendation: "ok" }, "a/b")).toContain("safe to proceed");
  });
  it("formats PR conflicts and blocked lists", () => {
    expect(formatPrConflicts(graph, 2)).toContain("blocked by #1 (blocks)");
    expect(formatPrConflicts(graph, 2)).toContain("a.ts L3");
    expect(formatPrConflicts(graph, 9)).toContain("not an open PR");
    expect(formatBlocked(graph)).toBe('#2 "B" — BLOCKED (waits on #1)');
  });
});

describe("client", () => {
  it("sends the bearer token and surfaces ProblemDetail errors", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ detail: "Token lacks the preflight:read scope" }), { status: 403 }));
    const c = new PrgraphClient({ baseUrl: "https://x.test/", token: "prg_abc", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(c.preflight({ repo: "a/b", patch: "x" })).rejects.toThrow(/403: Token lacks/);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/api/v1/preflight");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer prg_abc");
  });
  it("demo mode needs no token and uses the demo endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(high), { status: 200 }));
    const c = new PrgraphClient({ baseUrl: "https://x.test", demo: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await c.preflight({ repo: "a/b", patch: "x" })).risk).toBe("high");
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://x.test/api/demo/preflight");
  });
  it("refuses to call the token API without a token", async () => {
    const c = new PrgraphClient({ baseUrl: "https://x.test" });
    await expect(c.graph("a/b")).rejects.toBeInstanceOf(PrgraphError);
  });
});

describe("repoFromRemote", () => {
  it("parses https and ssh GitHub remotes", () => {
    expect(repoFromRemote("https://github.com/acme/storefront.git")).toBe("acme/storefront");
    expect(repoFromRemote("git@github.com:acme/store.front.git\n")).toBe("acme/store.front");
    expect(repoFromRemote("https://gitlab.com/a/b.git")).toBeNull();
  });
});
