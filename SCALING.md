# Scaling PRGraph to millions of users

This is the architecture and system-design plan for taking PRGraph from a single-box deployment to
millions of users. Every decision is stated as **Now → At scale → Trigger to switch**, so we only pay
for complexity when the numbers demand it. The engine-level rules live in the skills
([`prgraph-graph-ai`](.claude/skills/prgraph-graph-ai/SKILL.md),
[`prgraph-nextjs-backend`](.claude/skills/prgraph-nextjs-backend/SKILL.md)); this document is the
system around them.

---

## 1. Load model and SLOs

| Dimension | Assumption at scale |
|---|---|
| Users | ~1M registered, ~100k daily active |
| GitHub App installations | ~200k |
| Connected repos | ~2M (≈10% "hot": >10 open PRs) |
| Open PRs per repo | median 8, p99 ~2,000 (monorepos) |
| Webhooks | 50M+/day, bursty (CI fans out `check_run` events: ~10–30 per push) |
| Concurrent WebSocket viewers | ~200k peak |
| Preflight calls (agents / CI) | 5–20M/day — grows with AI-agent PR volume |

**SLOs.** Webhook → updated graph in the browser: p95 < 5 s. Readiness (CI/review) → plan update:
p95 < 3 s. Preflight API: p95 < 300 ms. Graph page TTFB: p95 < 500 ms. Availability 99.9 % for the
read path; the write path (recompute) may lag but must never lose an event.

What dominates cost is **not** the graph algorithm (linear in practice) — it is **GitHub API quota,
webhook fan-in, recompute frequency on hot repos, LLM spend, and WebSocket fan-out**. The design
below is organised around those five.

---

## 2. Process roles (one image, independently scaled)

**Now:** one Node process (`server/websocket.ts`) serves Next.js + Socket.IO and runs the stream
consumer and reconcile loop. `PROCESS_ROLE=all|web|worker` already splits web from workers.

**At scale:** the same container image, deployed as separate Kubernetes Deployments by role:

| Role | Does | Scales on |
|---|---|---|
| `web` | Next.js SSR + REST (`/api/**`, `/api/v1/**`) | CPU / RPS (HPA) |
| `realtime` | Socket.IO gateway only (no Next) | open connections |
| `ingest` | webhook receiver: verify HMAC, dedupe, enqueue | RPS — kept tiny and fast |
| `recompute` | stream consumers: fetch → engine → persist → publish | stream lag (KEDA) |
| `readiness` | CI/review fast path (GraphQL readiness + `planMerges`) | stream lag (KEDA) |
| `ai` | LLM refinement (separate bulkhead, own concurrency + budget) | queue depth, budget |
| `bot` | Check Run publisher (GitHub secondary-rate-limit aware) | queue depth |

**Trigger:** split `web`/`worker` first when recompute CPU starts affecting page latency (≈ a few
hundred active repos); split `realtime` past ~20k concurrent sockets per pod pool; split `ai` and
`bot` as soon as either has its own rate-limit/budget profile.

All roles are stateless; state lives in Postgres, Redis and object storage. Deploys are rolling,
with readiness probes on `/api/health`.

---

## 3. Ingestion: webhooks without loss or thundering herds

**Now:** `POST /api/webhooks/github` → HMAC on raw body → `SET NX` dedupe on `X-GitHub-Delivery` →
`XADD webhook-events` → 202. One consumer group, DLQ after 5 deliveries, reconcile sweep every
10 min. Concurrent events for one repo are **coalesced** (dirty set + re-run inside the lock).

**At scale:**

- **Partition by repo.** `N` streams `webhook-events:{hash(repoId) % N}` (Redis Cluster hash tags
  keep a partition on one shard). One consumer owns a partition at a time → per-repo ordering and
  no cross-consumer lock contention. At ~10k events/s move the log to **Kafka / Redpanda**
  (`key = repoId`) or **SQS FIFO** (`MessageGroupId = repoId`); the consumer code stays the same
  behind the queue interface.
- **Debounce + coalesce.** A push triggers `pull_request.synchronize` plus dozens of `check_run`
  events. Recompute jobs carry a per-repo debounce window (1–2 s) and the dirty set collapses N
  events into one run. Readiness events never trigger a full recompute (fast path).
- **Priority lanes.** `interactive` (manual re-sync, Re-check button) > `webhook` > `reconcile`.
  Separate streams with weighted consumption so a backfill never delays a user-visible update.
- **Trim payloads at the edge.** `check_run` payloads are large; `ingest` stores only the fields the
  worker needs (`repo`, `action`, PR number / head SHA, check name). Full payloads are not kept.
- **Lazy reconcile.** The sweep only re-checks repos with recent activity or viewers; cold repos
  recompute on demand when someone opens them.

**Trigger:** partition when one consumer group's lag p95 exceeds 2 s; move off Redis Streams when
stream memory or throughput approaches the Redis cluster's comfortable limits.

---

## 4. Incremental compute over immutable facts

**Now:** each recompute refetches PR files (cached 5 min), parses every patch, and rebuilds the whole
graph — fine up to hundreds of PRs (the engine is O(Σ files + pairs per hot file)).

**At scale:**

- **Per-PR facts keyed by `headSha`.** Parsed regions, symbol defs/refs, workspaces — all a pure
  function of the patch, so they are immutable per head SHA and cached forever (Redis → object
  storage). A webhook for PR #42 recomputes #42's facts only.
- **Pair-level incrementality.** Only pairs involving changed PRs are re-classified (via the
  file → PRs inverted index); unchanged pair results are reused. The pure engine stays pure: it
  takes facts in and returns the graph; caching wraps it.
- **Hot-file caps.** A file touched by 300 PRs means 45k pairs. Regenerable globs already remove
  lockfiles/snapshots; beyond that, cap per-file pair classification (k nearest by region) and
  mark the remainder `approx` — the UI shows them as a cluster.
- **Bounded deep verify.** diff3 deep verification stays capped per recompute
  (`MERGE_SIM_MAX_PAIRS`) and prioritised by blocking + severity; blobs are cached by `(path, sha)`.
- **Language.** The engine remains TypeScript (it is not the bottleneck). If p99 monorepos push
  recompute past ~1 s CPU, port `patch/` + `symbols/` to Rust → WASM behind the same function
  signatures; the property test (regions ≡ diff3) is the contract.

**Trigger:** introduce per-PR fact caching when p95 recompute CPU > 500 ms or GitHub file fetches
dominate quota.

---

## 5. GitHub API budget

GitHub gives each installation 5k–15k REST requests/hour plus a GraphQL point budget and secondary
rate limits on writes. This is the binding constraint at scale.

- **Per-installation token buckets** in Redis (`gh:bucket:{installId}`), refilled from
  `x-ratelimit-*` headers. Workers check the bucket before calling; when low they extend cache TTLs
  and defer non-critical work (deep verify, reconcile, bot writes).
- **Conditional requests everywhere.** ETag / `If-None-Match` on list endpoints; a 304 costs nothing.
- **Immutable caches.** Files by head SHA, blobs by `(path, sha)`, merge bases by head SHA —
  never refetched.
- **GraphQL batching.** Readiness is one paginated GraphQL query per repo (≈1 call per 50 PRs) rather
  than ~3 REST calls per PR.
- **Bot writes are content-hashed** (`check_runs.summary_hash`), so an unchanged Check Run is never
  re-posted; writes go through a per-installation concurrency limit with backoff on 403/429.
- **Webhook-first, poll-never.** Reconcile is a safety net, not a data source.

**Trigger:** token buckets as soon as any installation hits >50 % of its hourly quota.

---

## 6. Storage (PostgreSQL)

**Now:** Postgres 16 via Prisma; full rewrite of `dependencies` per recompute; `graph_snapshots`
stores the full graph JSON per recompute.

**At scale:**

- **Tenant key everywhere.** Every table carries `repo_id` (and through it `installation_id`), so the
  schema is ready for **Citus / sharding by installation** without query rewrites.
- **Snapshots:** partition `graph_snapshots` by month; keep full snapshots 30 days, downsample to
  hourly, then daily; move `graph_json` to **object storage** (content-addressed by hash) with only
  the pointer + summary counts in Postgres.
- **Patches:** stop persisting `pr_files.patch` in Postgres; store per-`headSha` facts/patches in
  object storage (preflight reads facts, not raw patches).
- **Diff-apply edges:** upsert changed `dependencies` rows instead of delete-all + insert.
- **Connections:** PgBouncer (transaction pooling) in front; Prisma with the pg driver adapter.
  Read replicas serve dashboards, history and preflight reads.
- **Migrations:** expand-only migrations (like `3_phase3_differentiators`), backfills in batches,
  contract in a later release.

**Trigger:** partition snapshots past ~100 GB; replicas when read QPS > ~2k; shard past ~5 TB or
when a single primary's write IOPS saturate.

---

## 7. Caching (Redis)

**Now:** one Redis for cache, dedupe, streams, pub/sub, rate limits and the AI cache.

**At scale:** **Redis Cluster**, with hash tags `{repo:<id>}` so a repo's graph, version counter,
lock and dirty set co-locate on one shard. Split by purpose into separate clusters once load
differs: (a) cache + locks, (b) streams (or Kafka), (c) pub/sub for realtime. The versioned graph
cache (`graph:{id}` + `graph:version:{id}`) lets readers detect staleness cheaply.

**AI verdict cache scoping.** Keys are content-addressed (`prompt version + provider + diffs`). For
private repos the key is additionally namespaced by installation, so even a hash collision cannot
cross tenants; public-repo verdicts may be shared globally.

---

## 8. Realtime fan-out

**Now:** Socket.IO with the Redis adapter, one room per repo, full graph pushed per update.

**At scale:**

- **WebSocket-only transport** (no long-polling) → no sticky sessions needed behind the L7 LB.
- **Sharded pub/sub** (`@socket.io/redis-streams-adapter` or Redis 7 `SPUBLISH`) so a message only
  reaches the shard that owns the room.
- **Diffs, not graphs.** Push a JSON patch of the graph (status changes, edge adds/removes) plus a
  version; clients that miss a version refetch `GET /graph`. Payload drops from ~100 KB to <2 KB.
- **~50k sockets per `realtime` pod**; scale on connection count. Beyond ~1M concurrent, consider a
  managed fan-out tier (Ably/Pusher-style) behind the same event contract.

---

## 9. AI cost at scale

- **Deterministic tiers first.** Exact textual conflicts (patch regions, diff3) are facts and never
  go to the LLM; only *approximate* edges are analysed. In practice this removes most pairs.
- **Content-addressed cache** (7-day TTL) — identical pairs never cost twice, across recomputes.
- **Per-tenant budgets** on top of the global daily breaker; free tiers default to the heuristic.
- **Batch APIs** (50 % cheaper) for non-interactive refinement (reconcile, backfills); synchronous
  calls only when a user is watching.
- **Cheapest adequate model first**, escalate only on `UNCERTAIN`; the choice is re-validated on the
  eval sets in CI (`npm run eval -- --provider …`). See [`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md).

---

## 10. Multi-tenancy and fairness

- Per-installation concurrency caps in every worker pool (a 2,000-PR monorepo cannot starve
  everyone else).
- Weighted fair queuing across installations within a partition.
- Per-token and per-session rate limits on the API (`/api/v1/**`: 60/min per token today; plan tiers
  later); 429 with `Retry-After`.
- Noisy-neighbour metrics by installation (bounded cardinality: top-N exported, rest aggregated).

---

## 11. Security at scale

- Secrets in a KMS-backed secret store; **envelope encryption** for stored tokens (per-tenant data
  keys wrapped by a KMS key), with key rotation that re-wraps data keys, not data.
- Webhook secret rotation with a dual-secret verification window.
- API tokens: hashed at rest, scoped, expiring by default, revocable; audit log of token use.
- Least-privilege GitHub App permissions (read-only + Checks write), re-reviewed per feature.
- Supply chain: lockfile-pinned deps, Dependabot grouped updates, `npm audit` gate in CI, CodeQL,
  minimal `permissions:` in workflows.

---

## 12. Observability

- **Tracing:** OpenTelemetry spans for ingest → queue → recompute → publish, with `traceparent`
  carried as a stream field so one trace covers the whole webhook-to-browser path.
- **Metrics:** existing Prometheus metrics (`prgraph_*`, incl. `merge_simulations_total`,
  `recompute_coalesced_total`, `readiness_updates_total`, `check_run_writes_total`,
  `preflight_requests_total`) plus per-role RED metrics; SLO burn-rate alerts on the §1 SLOs.
- **Cardinality controls:** no per-repo labels; per-installation labels only for the top-N.

---

## 13. Deployment and resilience

- Kubernetes, multi-AZ; **multi-region active-passive** at scale (RPO ≤ 5 min via streaming
  replication, RTO ≤ 30 min). GitHub webhooks target one global endpoint behind a global LB.
- Rolling deploys with readiness probes; expand-only DB migrations; feature flags for AI and bot.
- Every external call is wrapped (timeout → retry with jitter → circuit breaker → DLQ), and every
  degraded mode keeps the product working: AI off → heuristic; GitHub down → serve cached graph;
  Redis slow → cache ops time out and fall through.

---

## 14. Frontend at 2,000 nodes

- `onlyRenderVisibleElements` in React Flow and memoised node/edge components.
- Layout (dagre / ELK) in a **Web Worker** so the main thread stays responsive.
- **Level of detail:** the workspace aggregation (`aggregateByWorkspace`) collapses a monorepo into
  workspace nodes; expanding one workspace renders its PRs.
- Socket updates apply JSON patches; positions are preserved across status-only updates.

---

## 15. Decision log

| # | Area | Now | At scale | Trigger |
|---|---|---|---|---|
| 1 | Processes | one process, `PROCESS_ROLE` split | role-per-Deployment, KEDA | recompute CPU affects page latency |
| 2 | Queue | Redis Streams, one group | partitioned streams → Kafka / SQS FIFO | lag p95 > 2 s / throughput |
| 3 | Recompute | full rebuild, coalesced | incremental over SHA-keyed facts | p95 CPU > 500 ms |
| 4 | Engine language | TypeScript | Rust→WASM for parser/symbols | p99 recompute > 1 s CPU |
| 5 | GitHub quota | caches + ETags | per-install token buckets, priority lanes | any install > 50 % quota |
| 6 | Snapshots | JSON in Postgres | monthly partitions + object storage | > 100 GB |
| 7 | DB | single Postgres | PgBouncer → replicas → Citus by installation | read QPS / write IOPS |
| 8 | Cache | single Redis | Redis Cluster with `{repo:id}` hash tags | memory / ops limits |
| 9 | Realtime | Socket.IO + Redis adapter, full graph | WS-only, sharded pub/sub, JSON-patch diffs | > 20k sockets |
| 10 | AI | sync calls, global budget | batch API, per-tenant budgets, tenant-scoped cache | spend or latency |
| 11 | Frontend | dagre on main thread | worker layout, LOD, virtualised rendering | > 300 nodes |
