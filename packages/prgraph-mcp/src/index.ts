import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PrgraphClient } from "./client";
import { formatBlocked, formatPreflight, formatPrConflicts } from "./format";
import { diffAgainst, originRepo } from "./git";

/**
 * prgraph-mcp — PRGraph for AI coding agents and CI.
 *
 *   MCP (stdio):  prgraph-mcp
 *   CLI:          prgraph-mcp preflight [--repo owner/name] [--base origin/main] [--fail-on high|low]
 *                 git diff origin/main...HEAD | prgraph-mcp preflight --repo owner/name
 *
 * Env: PRGRAPH_URL (default https://prgraph.dev), PRGRAPH_TOKEN (scoped API token),
 *      PRGRAPH_DEMO=true to use the public demo endpoint (no token).
 */
const client = new PrgraphClient({
  baseUrl: process.env.PRGRAPH_URL ?? "https://prgraph.dev",
  token: process.env.PRGRAPH_TOKEN,
  demo: process.env.PRGRAPH_DEMO === "true",
});

async function resolveRepo(explicit?: string): Promise<string> {
  const repo = explicit ?? process.env.PRGRAPH_REPO ?? (await originRepo());
  if (!repo) throw new Error("Could not determine the repository; pass repo as owner/name");
  return repo;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (err: unknown) => ({ ...text(`PRGraph error: ${(err as Error).message}`), isError: true });

async function startServer() {
  const server = new McpServer({ name: "prgraph", version: "0.1.0" });

  server.registerTool(
    "preflight_check",
    {
      title: "Will my change collide with open PRs?",
      description:
        "Before opening a PR (or while editing), check whether the change conflicts with any open pull request: same lines (git conflict), same file (clean merge), or a symbol another PR renames/changes that this change uses. Omit `patch` to diff the current git branch against `base`.",
      inputSchema: {
        repo: z.string().optional().describe("owner/name; defaults to the git origin"),
        patch: z.string().optional().describe("unified diff; omit to run git diff <base>...HEAD"),
        base: z.string().optional().describe("base ref for git diff (default origin/main)"),
      },
    },
    async ({ repo, patch, base }) => {
      try {
        const r = await resolveRepo(repo);
        const diff = patch ?? (await diffAgainst(base ?? "origin/main"));
        if (!diff.trim()) return text("No changes relative to the base — nothing to check.");
        return text(formatPreflight(await client.preflight({ repo: r, patch: diff }), r));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_merge_plan",
    {
      title: "Merge plan",
      description: "The conflict-aware merge plan for the repo's open PRs: which PRs can merge now (in parallel), what each step unblocks, and which PRs are parked and why.",
      inputSchema: { repo: z.string().optional() },
    },
    async ({ repo }) => {
      try {
        return text(await client.mergePlanMarkdown(await resolveRepo(repo)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_pr_conflicts",
    {
      title: "Conflicts for one PR",
      description: "What blocks a given open PR and what it blocks, with files, line ranges, symbols and AI explanations.",
      inputSchema: { pr: z.number().int().positive(), repo: z.string().optional() },
    },
    async ({ pr, repo }) => {
      try {
        return text(formatPrConflicts(await client.graph(await resolveRepo(repo)), pr));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_blocked_prs",
    {
      title: "Blocked PRs",
      description: "List every open PR that is currently blocked or deadlocked, and what it waits on.",
      inputSchema: { repo: z.string().optional() },
    },
    async ({ repo }) => {
      try {
        return text(formatBlocked(await client.graph(await resolveRepo(repo))));
      } catch (err) {
        return fail(err);
      }
    },
  );

  await server.connect(new StdioServerTransport());
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function cli(args: string[]) {
  const repo = await resolveRepo(flag(args, "repo"));
  const piped = await readStdin();
  const patch = piped.trim() ? piped : await diffAgainst(flag(args, "base") ?? "origin/main");
  const result = await client.preflight({ repo, patch });
  console.log(formatPreflight(result, repo));
  const failOn = flag(args, "fail-on") ?? "high";
  const failing = failOn === "low" ? result.risk !== "none" : result.risk === "high";
  process.exit(failing ? 2 : 0);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "preflight") {
  cli(rest).catch((err) => {
    console.error(`prgraph-mcp: ${(err as Error).message}`);
    process.exit(1);
  });
} else {
  startServer().catch((err) => {
    console.error(`prgraph-mcp: ${(err as Error).message}`);
    process.exit(1);
  });
}
