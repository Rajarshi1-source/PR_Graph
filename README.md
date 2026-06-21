# PRGraph

**See which pull requests are safe to merge — at a glance.**

PRGraph turns a repository's open pull requests into a live, interactive **dependency graph**.
PRs that touch the same files create dependency edges; a deterministic graph engine computes the
**merge order** (topological sort), flags **cycles** (deadlocks), and labels every PR `SAFE`,
`BLOCKED`, or `DEADLOCKED`. GitHub webhooks recompute the graph in real time and push updates over
WebSockets, and Slack gets notified when merging one PR unblocks others.

> Status: MVP (Weeks 1–6). The AI semantic-conflict layer (Phase 2) is scaffolded behind a flag and
> deferred — see [AI (Phase 2)](#ai-phase-2-deferred).

## How it works

```mermaid
flowchart LR
  GH["GitHub: PRs + webhooks"] -->|"REST (Octokit)"| SVC["Graph service"]
  GH -->|"webhook (HMAC)"| WH["/api/webhooks/github"]
  WH -->|"XADD"| STREAM["Redis Stream"]
  STREAM --> WORKER["Recompute worker"]
  WORKER --> ENGINE["Pure graph engine"]
  SVC --> ENGINE
  ENGINE --> PG["(Postgres: PRs, deps, snapshots)"]
  ENGINE --> CACHE["(Redis: graph cache)"]
  WORKER -->|"graph:updated"| IO["Socket.IO"]
  IO --> UI["React Flow canvas"]
  WORKER --> SLACK["Slack notify"]
```

The **graph engine** (`src/lib/graph`) is pure and deterministic — no I/O, no clocks, no randomness —
so it is trivially testable and cacheable. Everything else (GitHub, Redis, Postgres, Slack, sockets)
is infrastructure around that core.

## Tech stack

- **Next.js 16** (App Router) + **React 19.2** on **Node.js 24**, TypeScript strict
- **Custom server** (`server/websocket.ts`) hosting the Next handler **and** Socket.IO in one process
- **PostgreSQL 16** via **Prisma 7** (driver adapter) · **Redis 7** (cache, dedupe, Streams queue, pub/sub)
- **React Flow** (`@xyflow/react`) + **dagre** layout · **Tailwind v4** + **shadcn/ui**
- **Octokit** (GitHub App + OAuth) · **Slack** (`@slack/web-api`) · **Prometheus** metrics

## Quickstart (local)

Prerequisites: Node 24, npm, Docker (for Postgres + Redis).

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env        # fill in GitHub App / OAuth secrets; generate SESSION_SECRET + ENCRYPTION_KEY

# 3. Start infrastructure
docker compose up -d postgres redis

# 4. Apply the schema
npm run db:generate
npm run db:migrate

# 5. Run the custom server (Next + Socket.IO + webhook worker)
npm run dev
# → http://localhost:3000
```

Generate secrets:

```bash
# SESSION_SECRET (any long random string)
openssl rand -hex 32
# ENCRYPTION_KEY (base64-encoded 32 bytes — used to encrypt stored tokens)
openssl rand -base64 32
```

### GitHub App

Create a GitHub App (Settings → Developer settings → GitHub Apps) with:

- **Permissions:** Pull requests (read), Contents (read), Metadata (read)
- **Webhook URL:** `https://<your-host>/api/webhooks/github`, secret = `GITHUB_WEBHOOK_SECRET`
- **Subscribe to events:** Pull request
- **Callback URL** (OAuth): `https://<your-host>/api/auth/callback`

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Custom server (Next + Socket.IO + worker) via tsx watch |
| `npm run build` | `next build` (Turbopack) |
| `npm run build:server` | Bundle `server/websocket.ts` → `dist/server.mjs` (esbuild) |
| `npm start` | Run the compiled custom server (`node dist/server.mjs`) |
| `npm test` | Vitest (graph engine suite) |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run db:migrate` / `db:deploy` | Prisma migrate (dev / prod) |
| `npm run eval` | AI semantic-conflict eval harness (Phase 2) |

## Docker

```bash
# build + run the full stack (app + postgres + redis)
SESSION_SECRET=... ENCRYPTION_KEY=... docker compose up --build

# with Prometheus
docker compose --profile monitoring up --build
```

The image deliberately does **not** use Next's `output: 'standalone'` — that would drop the Socket.IO
server. Instead it ships `.next` + the esbuild-bundled custom server + a production `node_modules`, and
runs `prisma migrate deploy` before booting (`scripts/start.sh`).

## Project structure

```
server/websocket.ts        Custom Node server: Next + Socket.IO + worker
src/lib/graph/             Pure deterministic engine (build, topo sort, cycles, diff) + service
src/lib/github/            Octokit client, PR/file fetchers, webhook HMAC verify
src/lib/events/            Redis Streams producer + consumer-group worker (DLQ)
src/lib/cache/             Redis singletons + cache-aside helpers
src/lib/slack/             Block Kit builder + notifier
src/lib/ai/                AI semantic-conflict layer (Phase 2, deferred)
src/lib/resilience/        Timeout / retry / circuit breaker
src/components/graph/      React Flow canvas, PR node, legend, detail panel
src/app/                   App Router pages + API route handlers
prisma/schema.prisma       Database schema
.claude/skills/            Engineering rules (wired via AGENTS.md)
```

## AI (Phase 2, deferred)

`src/lib/ai` contains a provider-agnostic LLM adapter, a versioned prompt registry, a Zod-validated
verdict schema, a content-addressed cache, and a **heuristic fallback** — wired but disabled
(`AI_ENABLED=false`). When enabled it refines file-overlap edges into semantic conflict verdicts
(`TRUE_CONFLICT` / `CO_LOCATED` / `UNCERTAIN`); on any failure it degrades to the deterministic
engine. The eval harness (`evals/`) gates accuracy in CI before the layer is turned on.

## License

[MIT](LICENSE)
