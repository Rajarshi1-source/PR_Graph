# PRGraph — Agent Rules

PRGraph is an open-source PR dependency visualiser: it fetches open PRs for a GitHub repo, builds a
file-overlap dependency graph (topological sort + cycle detection), renders an interactive React Flow
diagram of which PRs are safe to merge vs blocked, pushes real-time updates over Socket.IO on webhook
events, and notifies Slack when a blocker is merged. An optional Phase-2 AI layer refines file-level
overlaps into semantic conflict verdicts.

## Source of truth

The detailed engineering rules live in the skills under [`.claude/skills/`](.claude/skills/). **Read the
relevant skill before doing work in its area** — they are the authoritative, current (Next.js 16 /
Node 24) conventions and they override generic defaults.

| Area / triggers | Skill |
|---|---|
| Graph engine (inverted index, Kahn topo sort, DFS cycles, graph diff), AI semantic-conflict analyzer, LLM adapter, prompt registry, eval harness, MLOps | [`.claude/skills/prgraph-graph-ai/SKILL.md`](.claude/skills/prgraph-graph-ai/SKILL.md) |
| Backend: API Route Handlers, GitHub App OAuth + webhook receiver, Octokit service, Redis Streams queue/worker, Socket.IO custom server, Slack Bolt, Prisma, resilience, env/config | [`.claude/skills/prgraph-nextjs-backend/SKILL.md`](.claude/skills/prgraph-nextjs-backend/SKILL.md) |
| Auth/secrets/PII + full REST / WebSocket / webhook contract (HMAC §A.3, ProblemDetail §B.2, WS events §B.4, webhook events §B.5) | [`.claude/skills/prgraph-nextjs-backend/references/security-and-api.md`](.claude/skills/prgraph-nextjs-backend/references/security-and-api.md) |
| Frontend: App Router pages/layouts, Server vs Client Components, React Flow canvas, dagre layout, Socket.IO client, TanStack Query, SEO | [`.claude/skills/prgraph-nextjs-frontend/SKILL.md`](.claude/skills/prgraph-nextjs-frontend/SKILL.md) |
| UI styling: Tailwind + shadcn/ui, status tokens (SAFE/BLOCKED/DEADLOCKED), dark mode, a11y | [`.claude/skills/prgraph-tailwind-shadcn/SKILL.md`](.claude/skills/prgraph-tailwind-shadcn/SKILL.md) |

Cross-reference map: [`.claude/skills/PRGraph_Skills_Reference_Map.md`](.claude/skills/PRGraph_Skills_Reference_Map.md).
Planning docs: [`PRGraph_Implementation_Plan.md`](PRGraph_Implementation_Plan.md) (8-week plan, HLD/LLD,
DB/cache verdicts, §9.1 Dockerfile), [`PRGraph_starter_code.md`](PRGraph_starter_code.md) (runnable
engine + tests in Part 1, eval harness in Part 2), [`PRGraph_eval_connectors.md`](PRGraph_eval_connectors.md)
(prompt + adapter + diff-fetcher wiring).

## Non-negotiable baseline

- **Node.js 24 LTS**, **Next.js 16 App Router**, **React 19.2**, **TypeScript strict**. Never use
  Node 20 (EOL Apr 2026) or Next.js 14 (EOL).
- Route-handler `params` / `searchParams` and `cookies()`/`headers()` are **async Promises — await them**.
- A **custom Node server** (`server/websocket.ts`) hosts Next + Socket.IO: dev runs `tsx watch
  server/websocket.ts`; prod runs the esbuild bundle `node dist/server.mjs`. No `next dev`, no
  `--turbopack` flag, and **do not** set `output: 'standalone'` (it drops the Socket.IO layer).
- Request gating uses **`proxy.ts`** (not `middleware.ts`); lint with **`eslint`** (not `next lint`).
- Route handlers are thin (Zod validate → call a `lib/**` service → map to `Response`); no Octokit /
  Prisma / business logic inside handlers. Set `export const runtime = 'nodejs'` on stateful handlers.
- Errors use the shared RFC 9457 `problem()` helper. Secrets come only from a Zod-validated `env`
  (`lib/env.ts`); never log tokens. Prisma / Redis / Octokit are module singletons.
- **Webhooks:** verify GitHub HMAC-SHA256 on the **raw** body (constant-time) → dedupe on
  `X-GitHub-Delivery` (`SET NX`) → `XADD` to the Redis Stream → return 202 fast; recompute in the worker.
- **Graph core is pure & deterministic** (no I/O, no `Date.now`, no randomness) and fully unit-tested.
  The **AI layer is a refinement with a heuristic fallback** — AI failure degrades to deterministic
  behaviour, never to broken. Never hardcode an LLM model; go through the adapter.

## Styling

- shadcn/ui components are **copied into `components/ui`** and edited in-repo (never an npm dependency).
- Theme via semantic tokens / CSS variables (never raw hex); ship dark mode (`next-themes`); compose
  classes with `cn()`. Status is colour **plus** a label/icon (colour-blind safe). Preserve Radix a11y.

## Workflow

- Prefer editing existing files; match existing conventions. After substantive edits, check lints.
- Shared graph DTOs (`GraphNode`, `GraphEdge`, `DependencyGraph`) live in one `types/` module imported
  by both server and client — never re-declared in the UI.
