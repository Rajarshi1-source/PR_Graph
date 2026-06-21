---
name: prgraph-nextjs-backend
description: >-
  Build and maintain the PRGraph backend — the server side of the Next.js 16 app on Node.js 24 LTS.
  Use for ANY backend work: API Route Handlers under app/api, GitHub App OAuth plus the webhook
  receiver (HMAC-SHA256 verify, idempotent delivery dedup), the Octokit GitHub service (paginated
  PR/file fetch, ETags, rate-limit governor), the Redis Streams webhook queue and consumer worker, the
  Socket.IO custom server, the Slack Bolt notifier, Prisma data access, resilience (timeouts,
  retry/backoff, circuit breaker, DLQ), config, errors, or backend tests. Trigger on route handler,
  app/api, async params, webhook, Octokit, GitHub App, Redis Streams, Socket.IO, custom server,
  Turbopack, proxy.ts, Slack Bolt, Prisma, circuit breaker, rate limit, or background worker.
  MANDATE: Node.js 24 LTS plus Next.js 16 App Router plus TypeScript strict — Node 20 hit
  end-of-life in April 2026 (target Node 24), and Next.js 14 is end-of-life (target 16). Route-handler
  `params` are async Promises in Next.js 16 and must be awaited. For auth, secrets, and the full
  REST/webhook/WebSocket contract read references/security-and-api.md. Pair with prgraph-graph-ai for
  graph and LLM logic.
---

# Next.js 16 API Routes + Node.js 24 — PRGraph Backend

You are a senior backend engineer building the server side of **PRGraph** (open-source PR dependency
visualiser) as the API half of a **Next.js 16 App Router** app, **Node.js 24 LTS**, **TypeScript
strict**. The backend pulls open PRs from GitHub, queues webhook events through Redis Streams,
recomputes the dependency graph asynchronously, persists it in PostgreSQL via Prisma, pushes updates
over Socket.IO, and notifies Slack. It is I/O-heavy and compute-light by design.

## Why these versions (state it confidently if asked)

- **Node.js 24 LTS (Krypton):** the current Active LTS (Oct 2025 → EOL Apr 2028) — the right default
  for a new 2026 project, with the longest support runway.
- **Node 20 is end-of-life (Apr 2026).** The original plan's `node:20-alpine` must be upgraded.
  Node 22 is only Maintenance LTS; Node 26 is Current (not LTS until Oct 2026) and too bleeding-edge
  for a deployment you put on a resume. So: **Node 24**.
- **Node 24 perks used here:** built-in WebSocket client, stable `node:test`, `require(esm)`, modern
  fetch/Undici, faster startup (Maglev) — all relevant to a webhook/Socket.IO service.
- **Next.js 16 (not 14).** Next.js 14 is end-of-life and no longer gets security patches; 16 is the
  current stable line (16.2.x). The App Router model is unchanged, but the four load-bearing v16
  differences below matter to this backend: **async request APIs** (route-handler `params` is now a
  Promise), **Turbopack is the default bundler**, **`middleware.ts` → `proxy.ts`**, and the
  **caching APIs changed** (`revalidateTag` needs a `cacheLife` profile; `updateTag` is new).
- **Next.js 16 App Router** stays as the plan defines it. Route Handlers (`app/api/**/route.ts`) are
  the REST layer; a **custom Node server** hosts Socket.IO (App Router route handlers cannot hold
  long-lived WebSocket connections).

## Critical rules (never violate)

- **Route Handlers do HTTP only:** parse and validate input (Zod), call a service, map the result to
  a `Response`/`NextResponse`. No business logic, no Octokit calls, no Prisma queries inside a route
  handler — delegate to `lib/**` services.
- **`params` is async — await it.** In Next.js 16 the route-handler context `params` is a `Promise`;
  `await ctx.params` before using it. Synchronous access is removed and errors.
- **Never trust a webhook.** Verify the GitHub HMAC-SHA256 signature against the **raw** request body
  with a constant-time compare before doing anything else. An unverified payload is rejected with 401.
- **The webhook endpoint returns 200 fast (under ~1s).** It validates, dedupes, `XADD`s the event to
  a Redis Stream, and returns. The graph recompute happens in the worker — never inline in the
  request. GitHub requires a response within 10s; recompute can take 5–15s.
- **Idempotency everywhere.** Dedupe webhook deliveries on `X-GitHub-Delivery` (Redis `SET NX`, 5-min
  TTL). The graph recompute is idempotent w.r.t. current GitHub state (full recompute, not deltas).
- **No hardcoded secrets.** All keys/URLs come from env, validated once at boot through a Zod schema
  (`lib/env.ts`). Never log tokens.
- **Errors are RFC 9457 ProblemDetail JSON** via one shared helper — never leak stack traces or raw
  error strings to clients.
- **Singletons for clients.** Prisma, Redis (ioredis), and Octokit factories are module singletons
  guarded against hot-reload duplication in dev (`globalThis` cache).

## Layered architecture

```
app/api/**/route.ts   → HTTP only: Zod validate, status codes, ProblemDetail errors
        ↓
lib/<domain>/*.ts      → services: business logic, orchestration, resilience boundaries
        ↓
lib/db (Prisma)  +  lib/github (Octokit)  +  lib/cache (Redis)  +  lib/slack (Bolt)
        ↓
PostgreSQL              external GitHub API       Redis (cache/streams)   Slack
```

Folder layout follows §5 of the plan: `app/api`, `lib/{graph,github,slack,db,cache,websocket,events}`,
`server/websocket.ts` (custom server), `prisma/schema.prisma`.

## Route Handlers (App Router) — `params` is async in Next.js 16

```typescript
// app/api/repos/[repoId]/graph/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getGraphForRepo } from '@/lib/graph/service';
import { problem } from '@/lib/http/problem';
import { requireSession } from '@/lib/auth/session';

export const runtime = 'nodejs';          // NOT edge — we use Prisma, ioredis, crypto

const Params = z.object({ repoId: z.coerce.number().int().positive() });

// ctx.params is a Promise in Next.js 16 — await it before validating.
export async function GET(req: NextRequest, ctx: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await ctx.params;                 // ← await, do not read synchronously
  const parsed = Params.safeParse({ repoId });
  if (!parsed.success) return problem(400, 'Invalid repoId');

  const session = await requireSession(req);          // 401 inside if missing
  const graph = await getGraphForRepo(parsed.data.repoId, session.userId);
  if (!graph) return problem(404, 'Repo not connected or no graph yet');

  return NextResponse.json(graph, {
    headers: { 'Cache-Control': 'private, max-age=5' },
  });
}
```

`problem()` is the single error shape (see `references/security-and-api.md` §B.2). Always set
`export const runtime = 'nodejs'` on handlers that touch Prisma/Redis/crypto. For typed context, run
`npx next typegen` and use the generated helper: `ctx: RouteContext<'/api/repos/[repoId]/graph'>`.

## GitHub service (Octokit) — pagination, ETags, rate-limit governor

```typescript
// lib/github/fetchPRs.ts
import { withCache } from '@/lib/cache/decorators';
import { octokitFor } from './client';

export const fetchOpenPRs = withCache(
  (repo: RepoRef) => `gh:prs:${repo.id}`, 120,             // 2-min cache
  async (repo: RepoRef): Promise<PR[]> => {
    const octokit = await octokitFor(repo.installationId); // installation token
    // paginate handles >100 PRs and respects secondary rate limits
    return octokit.paginate(octokit.rest.pulls.list, {
      owner: repo.owner, repo: repo.name, state: 'open', per_page: 100,
    });
  },
);
```

- **Pagination:** always `octokit.paginate` — never assume one page.
- **Files per PR:** `octokit.rest.pulls.listFiles` returns `patch` hunks too — that `patch` field is
  exactly what the AI analyzer (prgraph-graph-ai) consumes. Cache 5 min.
- **ETags:** pass `If-None-Match`; a `304` does **not** count against the quota. Store the ETag in
  Redis alongside the cached body.
- **Rate-limit governor:** read `x-ratelimit-remaining` from every response into
  `gh:ratelimit:{installId}`. Below 500, extend cache TTLs and defer non-critical syncs. GitHub
  allows 5,000 req/hr per installation; a 50-PR sync is ~51 calls.

## Webhook receiver — verify, dedupe, enqueue, return fast

```typescript
// app/api/webhooks/github/route.ts
import { NextRequest } from 'next/server';
import { verifyGithubSignature } from '@/lib/github/verifyWebhook';
import { redis } from '@/lib/cache/redis';
import { enqueueWebhook } from '@/lib/events/queue';
import { problem } from '@/lib/http/problem';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const raw = await req.text();                              // RAW body — needed for HMAC
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  if (!verifyGithubSignature(raw, sig)) return problem(401, 'Bad signature');

  const deliveryId = req.headers.get('x-github-delivery') ?? '';
  const first = await redis.set(`webhook:dedup:${deliveryId}`, '1', 'EX', 300, 'NX');
  if (first === null) return new Response(null, { status: 202 });  // duplicate → ack, skip

  const event = req.headers.get('x-github-event') ?? '';
  await enqueueWebhook(event, JSON.parse(raw));              // XADD to Redis Stream
  return new Response(null, { status: 202 });                // <1s, recompute happens async
}
```

(`req.headers` inside a route handler is the synchronous `Request.headers` — fine. The async rule
applies to the `cookies()`/`headers()` helpers from `next/headers` and to `params`/`searchParams`.)
HMAC details, replay handling, and the full webhook event contract live in
`references/security-and-api.md` (§A.3, §B.5).

## Redis Streams — queue + worker + DLQ

```typescript
// lib/events/queue.ts
import { redis } from '@/lib/cache/redis';
export const STREAM = 'webhook-events';
export const GROUP = 'graph-workers';

export async function enqueueWebhook(event: string, payload: unknown) {
  await redis.xadd(STREAM, '*', 'event', event, 'payload', JSON.stringify(payload));
}
```

```typescript
// lib/events/worker.ts  (runs in the custom server process)
import { redis } from '@/lib/cache/redis';
import { STREAM, GROUP } from './queue';
import { recomputeGraph } from '@/lib/graph/service';

const DLQ = 'webhook-events-dlq';
const MAX_RETRIES = 5;

export async function runWorker(consumer: string) {
  await redis.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM').catch(() => {}); // idempotent
  for (;;) {
    const res = await redis.xreadgroup('GROUP', GROUP, consumer, 'COUNT', 5,
      'BLOCK', 5000, 'STREAMS', STREAM, '>');
    if (!res) continue;
    for (const [, entries] of res as any) {
      for (const [id, fields] of entries) {
        try {
          await recomputeGraph(parseFields(fields));    // recompute → diff → push → notify
          await redis.xack(STREAM, GROUP, id);
        } catch (err) {
          const deliveries = await retryCount(id);
          if (deliveries >= MAX_RETRIES) {
            await redis.xadd(DLQ, '*', 'id', id, 'error', String(err));
            await redis.xack(STREAM, GROUP, id);          // remove from pending
          }
          // else: leave unacked → redelivered next loop (at-least-once)
        }
      }
    }
  }
}
```

`XACK` only on success; on repeated failure move to the DLQ so a poison message can't wedge the
consumer. The DLQ depth is an alertable metric.

## Socket.IO — custom server, rooms, scale-out adapter

App Router route handlers can't host a WebSocket server, so Socket.IO runs in a **custom Node
server** that also serves Next:

```typescript
// server/websocket.ts
import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { pub, sub } from '@/lib/cache/redis';

const app = next({ dev: process.env.NODE_ENV !== 'production' });
await app.prepare();                       // Next 16 compiles the app with Turbopack here, internally
const httpServer = createServer(app.getRequestHandler());
const io = new Server(httpServer, { path: '/api/socket' });
io.adapter(createAdapter(pub, sub));     // multi-replica fan-out via Redis Pub/Sub

io.on('connection', (socket) => {
  socket.on('graph:subscribe', (repoId: string) => socket.join(`repo:${repoId}`));
  socket.on('graph:unsubscribe', (repoId: string) => socket.leave(`repo:${repoId}`));
});

export function pushGraphUpdate(repoId: number, payload: unknown) {
  io.to(`repo:${repoId}`).emit('graph:updated', payload);
}
httpServer.listen(3000);
```

**Next.js 16 + custom server — get this right:**

- **You do not run `next dev` for a custom server.** You launch the custom server directly; Turbopack
  (the default dev bundler in 16) is engaged automatically by `next({ dev: true })` when it compiles
  the app. There is **no `--turbopack` flag** to add anywhere.
- **The custom server file is NOT processed by the Next.js compiler/bundler** (per the custom-server
  docs). It runs on Node directly, so it must be Node-runnable. This file is TypeScript and uses the
  `@/` path alias and top-level `await`, so run it with **`tsx`** (handles TS + ESM + tsconfig path
  aliases) in dev. For production, **bundle it to a single ESM file with esbuild** (`dist/server.mjs`)
  and run `node dist/server.mjs` — this is what the §9.1 Dockerfile does, so the runtime image needs
  no TS toolchain. (`tsx server/websocket.ts` also works in prod if you prefer to skip the bundle.)
- **Scripts** for a custom-server app:

```jsonc
// package.json — no --turbopack flag in Next.js 16; the custom server is launched directly
{
  "scripts": {
    "dev": "tsx watch server/websocket.ts",       // Turbopack engaged via next({ dev:true })
    "build": "next build",                         // → .next  (Turbopack default; no webpack config)
    "build:server": "esbuild server/websocket.ts --bundle --platform=node --format=esm --target=node24 --packages=external --outfile=dist/server.mjs",
    "start": "node dist/server.mjs",               // the compiled custom server, NOT .next/standalone
    "lint": "eslint ."                             // next lint was removed in 16
  }
}
```

> `--packages=external` keeps `next`, `socket.io`, `@socket.io/redis-adapter`, `ioredis`, and
> `@prisma/client` in `node_modules`; esbuild resolves the `@/` alias from `tsconfig.json` and inlines
> only first-party code. ESM output is required for the top-level `await app.prepare()`. Keep `prisma`
> in `dependencies` so `migrate deploy` runs offline in the image (see §9.1).

The Redis adapter is what makes WebSocket delivery correct when you run more than one replica (§17 of
the plan). The event contract (`graph:subscribe`, `graph:current`, `graph:updated`) is in
`references/security-and-api.md` §B.4.

## Route gating — `proxy.ts` (replaces `middleware.ts`)

If you intercept requests for auth gating (e.g. redirect anonymous users away from `/dashboard` or
`/repo/**`), Next.js 16 uses **`proxy.ts`** (exported function `proxy`, Node.js runtime) instead of
`middleware.ts`. Keep it a lightweight presence check; real session verification stays in
`requireSession` at the route/service layer.

```typescript
// src/proxy.ts
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get('prg_session')?.value);
  const p = request.nextUrl.pathname;
  if (!hasSession && (p.startsWith('/dashboard') || p.startsWith('/repo'))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*', '/repo/:path*'] };
```

## Resilience (every external call is wrapped)

```typescript
// lib/resilience/breaker.ts
import CircuitBreaker from 'opossum';

export function breaker<T extends (...a: any[]) => Promise<any>>(
  fn: T, name: string, fallback?: (...a: Parameters<T>) => ReturnType<T>,
) {
  const cb = new CircuitBreaker(fn, {
    timeout: 10_000, errorThresholdPercentage: 50, resetTimeout: 30_000, volumeThreshold: 5,
  });
  if (fallback) cb.fallback(fallback);            // e.g. serve cached graph when GitHub is down
  cb.on('open', () => metrics.inc(`breaker.${name}.open`));
  return (...args: Parameters<T>) => cb.fire(...args) as ReturnType<T>;
}
```

Layer: **timeout** bounds one call, **retry+backoff+jitter** handles a blip, **circuit breaker**
handles a sustained outage, **bulkhead** (separate worker concurrency for webhook processing vs AI
analysis) stops one slow path sinking another, **DLQ** guarantees replay. See the plan §16.

## Config — Zod-validated env, validated once at boot

```typescript
// lib/env.ts
import { z } from 'zod';
const Env = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  GITHUB_APP_ID: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string(),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  GITHUB_CLIENT_ID: z.string(), GITHUB_CLIENT_SECRET: z.string(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SESSION_SECRET: z.string().min(32),
});
export const env = Env.parse(process.env);   // fail fast on misconfig
```

## Reference — security & the full contract

**For anything touching auth, secrets, PII, or designing/changing an endpoint** — the GitHub App
installation-token vs user-OAuth model, webhook HMAC verification, the session cookie/JWT design,
Slack OAuth + request signing, token encryption at rest, rate limiting, CORS/CSRF, and the complete
REST + WebSocket + webhook contract (every endpoint, the ProblemDetail error shape, pagination,
idempotency) — read [`references/security-and-api.md`](references/security-and-api.md). Load it
whenever a task touches auth, secrets, or an endpoint shape.

## Testing (Vitest + Testcontainers)

```typescript
// integration: spin real Postgres + Redis, hit a route handler
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
// ...start containers, run prisma migrate deploy, then exercise the handler & worker
```

Unit-test the GitHub service against recorded fixtures (nock/msw); the graph algorithms are tested in
prgraph-graph-ai. Use `node:test` or Vitest — both fine on Node 24.

## Anti-patterns to fix on sight

| Anti-pattern | Fix |
|---|---|
| Reading route-handler `params` synchronously | `const { x } = await ctx.params` — it is a `Promise` in Next.js 16 |
| Octokit/Prisma calls inside a route handler | move to a `lib/**` service; handler stays thin |
| Recomputing the graph inline in the webhook request | `XADD` to the stream, return 202, recompute in the worker |
| Verifying the webhook against parsed JSON | verify HMAC against the **raw** body, constant-time |
| `node:20-alpine` base image | `node:24-alpine` (Node 20 is EOL) |
| `--turbopack` flag / running `next dev` for the custom server | launch the custom server directly (`tsx`/`node`); Turbopack is default |
| Running `server/websocket.ts` with bare `node` (TS + `@/` alias) | run with `tsx`, or precompile — Next does not bundle the custom server file |
| `middleware.ts` for request gating | `proxy.ts` (export `proxy`, Node.js runtime) |
| `next lint` in CI | run `eslint` directly (`next lint` removed in 16) |
| `runtime = 'edge'` on a handler using Prisma/crypto | `runtime = 'nodejs'` |
| Socket.IO inside an App Router route handler | custom Node server (`server/websocket.ts`) |
| Single-replica Socket.IO with no adapter when scaling | `@socket.io/redis-adapter` |
| `new PrismaClient()` per request | module singleton with `globalThis` guard |
| Scattered `process.env.X` reads | one Zod-validated `env` object at boot |
| Ad-hoc `{ error: '...' }` responses | RFC 9457 `problem()` helper |
| No dedupe on webhook deliveries | `SET NX` on `X-GitHub-Delivery` |

## Quick reference

- Runtime: **Node.js 24 LTS**; framework: **Next.js 16 App Router**; language: TypeScript strict.
- Route-handler `params` is **async** — `await ctx.params`; `cookies()`/`headers()` from `next/headers` are async too.
- Handlers thin → services in `lib/**`; `export const runtime = 'nodejs'` on stateful handlers.
- Webhook: verify HMAC on raw body → dedupe (`SET NX`) → `XADD` → 202 fast; recompute in the worker.
- GitHub: `octokit.paginate`, ETags (304s are free), rate-limit governor in Redis.
- Queue: Redis Streams + consumer group + DLQ; Socket.IO via custom server + Redis adapter.
- Custom server: launched directly (Turbopack is default, no flag); dev `tsx watch server/websocket.ts`, prod esbuild bundle → `node dist/server.mjs`; `middleware.ts` → `proxy.ts`; `next lint` → `eslint`.
- Resilience: timeout + retry/backoff + opossum breaker + bulkhead + DLQ.
- Secrets, auth, full REST/WS/webhook contract → `references/security-and-api.md`.
- Graph + AI/LLM logic → prgraph-graph-ai; UI → prgraph-nextjs-frontend / prgraph-tailwind-shadcn.
