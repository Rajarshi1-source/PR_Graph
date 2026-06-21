# PRGraph — Security & API Reference

Detailed reference for the **Next.js 16 (App Router) + Node.js 24** backend, loaded on demand for any
task touching **authentication, authorization, secrets, PII handling, or the REST / webhook /
WebSocket contract**. The main `SKILL.md` (prgraph-nextjs-backend) carries the day-to-day rules; this
file carries the depth. All examples are TypeScript, Node 24, App Router Route Handlers.

## Contents
- Part A — Security (A.1 GitHub auth models · A.2 user sessions · A.3 webhook HMAC · A.4 Slack ·
  A.5 secrets/token encryption · A.6 rate limiting · A.7 CORS/CSRF · A.8 PII)
- Part B — API contract (B.1 REST endpoints · B.2 error shape · B.3 pagination/idempotency ·
  B.4 WebSocket events · B.5 webhook events)

---

## Part A — Security

### A.1 Two GitHub auth models — do not conflate them

PRGraph uses the GitHub API in **two distinct ways**, with two different credentials:

1. **User OAuth (login / who is this person).** The GitHub OAuth flow identifies the user and lists
   the repos/installations they can see. Exchange the `code` for a **user access token**; use it only
   for user-scoped reads during login. Persist a session (A.2), not the raw token in the client.
2. **GitHub App installation (acting on a repo).** All PR/file reads and webhook subscriptions happen
   as the **installation**, not the user. You authenticate as the App with a **JWT signed by the
   App's private key (RS256)**, then exchange it for a short-lived **installation access token**
   (~1 hour) per installation. Octokit's App auth strategy handles minting + caching these.

```
App JWT (RS256, signed with GITHUB_APP_PRIVATE_KEY, exp <= 10 min)
   → POST /app/installations/{id}/access_tokens
   → installation token (1h)  → used for pulls.list / pulls.listFiles for that repo
```

Never use a user token to read PR data for the graph — use the installation token. Installation
tokens are short-lived, so they generally don't need encryption at rest; you mint them on demand.

### A.2 User sessions (after OAuth)

- After OAuth, create a **stateless session** (signed cookie or JWT) — `httpOnly`, `Secure`,
  `SameSite=Lax`, short-ish lifetime, signed with `SESSION_SECRET` (>=32 bytes). NextAuth/Auth.js with
  the GitHub provider is the pragmatic default; a hand-rolled signed cookie is fine for the MVP.
- The session carries `userId` and the user's GitHub login — **no tokens, no PII beyond what's
  needed**. Server code resolves installation tokens from the App credentials, not from the session.
- `requireSession(req)` runs at the top of every protected Route Handler and returns 401 early.

### A.3 Webhook security (the most important section)

GitHub signs every webhook with HMAC-SHA256 over the **raw request body** using
`GITHUB_WEBHOOK_SECRET`. You **must** verify it against the raw body (not the parsed JSON) with a
constant-time compare, before any processing.

```typescript
// lib/github/verifyWebhook.ts
import crypto from 'node:crypto';
import { env } from '@/lib/env';

export function verifyGithubSignature(rawBody: string, signatureHeader: string): boolean {
  if (!signatureHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', env.GITHUB_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);   // constant-time
}
```

Rules:
- Read the body with `await req.text()` and verify **before** `JSON.parse`. In the App Router this is
  straightforward (route handlers get the raw stream); never let a body parser consume it first.
- **Replay / duplicate protection:** dedupe on `X-GitHub-Delivery` (Redis `SET NX`, 5-min TTL).
- A bad or missing signature → **401**, logged + metered (possible spoofing).
- The webhook secret is per-App; rotate it in the GitHub App settings and in `GITHUB_WEBHOOK_SECRET`
  together.

### A.4 Slack OAuth + request signing

- **Install:** standard Slack OAuth; store the returned **bot token** per repo's Slack config.
- **Inbound Slack requests** (slash commands, interactivity) are verified with the Slack signing
  secret: recompute `v0=HMAC_SHA256(signing_secret, "v0:{timestamp}:{rawBody}")`, constant-time
  compare to `X-Slack-Signature`, and reject if the timestamp is older than ~5 minutes (replay).
- Notifications are **best-effort**: a Slack failure must never block a graph update (see B.4). Wrap
  Slack calls in the circuit breaker with a retry queue.

### A.5 Secrets & token encryption at rest

- All secrets come from env, validated once at boot (`lib/env.ts`, Zod). **Never log a token.**
- **Encrypt long-lived stored tokens** (Slack bot tokens; user refresh tokens if you keep them) with
  **AES-256-GCM** using a key from `ENCRYPTION_KEY` (KMS in production). Store `iv:tag:ciphertext`.

```typescript
// lib/crypto/secretbox.ts
import crypto from 'node:crypto';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'base64'); // 32 bytes
export function seal(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
export function open(sealed: string) {
  const [iv, tag, ct] = sealed.split(':').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
```

- The GitHub **App private key** lives only in env/secret store, never in the DB or client.

### A.6 Rate limiting

- **Our endpoints:** Redis fixed/sliding window per session+route (e.g. 100/min) and tighter on
  `POST /api/repos/:id/sync` (e.g. 5/min) to prevent quota abuse.
- **GitHub quota governor:** track `x-ratelimit-remaining` per installation in
  `gh:ratelimit:{installId}`; below 500, extend cache TTLs and defer non-critical syncs. Use ETags so
  unchanged data returns 304 (free).

### A.7 CORS / CSRF

- The frontend and API are the **same Next origin** → no cross-origin CORS needed for first-party
  calls. If you expose a public read API later, allow-list origins explicitly.
- **CSRF:** cookie-based session calls that mutate state need CSRF protection (double-submit token or
  SameSite=Lax + same-origin checks). **Webhook and Slack endpoints are CSRF-exempt** — they're
  machine-to-machine and protected by HMAC signatures instead.

### A.8 PII / data minimization

- PRGraph stores public PR metadata (titles, authors, filenames) — treat author logins/avatars as the
  only "personal" data; don't store more than the graph needs. Honor repo disconnection by cascading
  deletes (the Prisma schema uses `onDelete: Cascade`). Don't index private-repo contents beyond what
  the installation grants.

---

## Part B — API contract

### B.1 REST endpoints (Route Handlers under `app/api`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/auth/github` | none | start GitHub OAuth |
| GET | `/api/auth/callback` | none | exchange `code`, create session |
| GET | `/api/auth/me` | session | current user + installations |
| POST | `/api/auth/logout` | session | clear session |
| GET | `/api/repos` | session | connected repos |
| POST | `/api/repos/:repoId/sync` | session | trigger manual re-sync (rate-limited) |
| DELETE | `/api/repos/:repoId` | session | disconnect repo (cascade delete) |
| GET | `/api/repos/:repoId/graph` | session | current dependency graph |
| GET | `/api/repos/:repoId/graph/history` | session | snapshot history |
| GET | `/api/repos/:repoId/graph/merge-order` | session | Kahn levels |
| GET | `/api/repos/:repoId/graph/stats` | session | counts (safe/blocked/deadlocked) |
| POST | `/api/webhooks/github` | HMAC | GitHub event receiver (returns 202 fast) |
| GET | `/api/slack/install` | session | Slack OAuth redirect |
| POST | `/api/slack/events` | Slack sig | Slack events / interactivity |
| GET | `/api/health` | none | liveness/readiness (checks PG + Redis) |

### B.2 Error shape — RFC 9457 ProblemDetail

```typescript
// lib/http/problem.ts
import { NextResponse } from 'next/server';
export function problem(status: number, detail: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { type: 'about:blank', title: titleFor(status), status, detail, ...extra },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}
```

Validation errors carry an `errors` array; never leak stack traces. One shape for every handler.

### B.3 Pagination, versioning, idempotency

- **Pagination:** list endpoints accept `?page` / `?perPage` (or cursor) and return `{ items, page,
  hasNext }`. Internally always use `octokit.paginate` against GitHub.
- **Versioning:** prefix future breaking changes (`/api/v2/...`); the MVP is unversioned.
- **Idempotency:** webhooks dedupe on `X-GitHub-Delivery`; `POST /sync` is naturally idempotent (it
  recomputes from current GitHub state).

### B.4 WebSocket (Socket.IO) event contract — path `/api/socket`

| Direction | Event | Payload | Meaning |
|---|---|---|---|
| client→server | `graph:subscribe` | `repoId: string` | join room `repo:{repoId}` |
| client→server | `graph:unsubscribe` | `repoId: string` | leave room |
| server→client | `graph:current` | `DependencyGraph` | snapshot sent on subscribe |
| server→client | `graph:updated` | `{ graph, diff, syncedAt }` | recompute finished; `diff` lists status transitions |

`diff` drives the UI animations (e.g. `#57 BLOCKED→SAFE`) and the Slack message. Multi-replica
delivery requires the `@socket.io/redis-adapter`.

### B.5 Webhook event contract (which GitHub events, what we do)

Subscribe to **`pull_request`** (actions: `opened`, `closed`, `synchronize`, `edited`, `reopened`) and
optionally **`installation`/`installation_repositories`** (connect/disconnect). On any relevant
`pull_request` action:

1. Verify HMAC (A.3) → dedupe on delivery id → `XADD` to `webhook-events` → return **202**.
2. The worker recomputes the **whole** graph from current GitHub state (idempotent w.r.t. ordering —
   GitHub does not guarantee webhook order), diffs against the last snapshot, persists, pushes
   `graph:updated`, and fires the Slack notification for newly-unblocked PRs.
3. A periodic reconciliation sync (every N minutes) is the safety net for any webhook GitHub dropped —
   this is what bounds staleness even under lost events.

> Interview line: *"I verify the webhook HMAC on the raw body with a constant-time compare, dedupe on
> the delivery id, and only then enqueue — the endpoint returns 202 in under a second and the heavy
> recompute runs in a worker, so I never miss GitHub's 10-second deadline. Webhook order isn't
> guaranteed, so I recompute from current state rather than applying deltas, which makes processing
> idempotent."*
