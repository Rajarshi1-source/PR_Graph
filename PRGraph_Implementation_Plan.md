# PRGraph — Open Source PR Dependency Visualiser

## Complete Implementation Plan for Junior Full-Stack + AI Engineer Interview (2026)

---

> ### Revision 2 — What Changed and Why
>
> The original plan (Rev 1) was a strong pure full-stack + graph-algorithms project. This revision keeps all of that intact and **closes the gaps your interview checklist actually grades on**, plus adds one differentiator that lifts the project from "good fresher project" to "I shipped an AI feature with a proper MLOps wrapper."
>
> **Gaps closed (these were thin or missing in Rev 1):**
> - **Dedicated Resilience Patterns** section (§16) — retry+backoff+jitter, timeout, bulkhead, dead-letter queue, graceful degradation. Rev 1 only had a circuit breaker.
> - **Availability & Consistency Patterns** section (§17) — CAP positioning, the graph's eventual-consistency model, webhook ordering, at-least-once + idempotency, cache consistency. Was absent in Rev 1.
> - **Mitigation Strategies** section (§18) — a single consolidated failure-mode → blast-radius → mitigation table.
> - **Deployment Strategies** section (§19) — rolling vs blue-green vs canary, expand-contract DB migrations, zero-downtime, rollback. Rev 1 only had Docker/K8s mechanics.
>
> **Differentiator added — AI Semantic Conflict Analysis (§14) + MLOps Wrapper (§15):**
> Rev 1 detected conflicts at the *file* level only ("both PRs touch `auth.ts` → blocked"). That over-reports: two PRs editing different functions in the same file don't truly conflict. This revision adds an optional LLM pass that reads the actual diff hunks of two overlapping PRs and decides whether they *semantically* conflict, with a plain-English explanation and a suggested resolution. This is what introduces the missing **MLOps wrapper** (provider-agnostic adapter, prompt versioning, eval harness gating CI, response caching, cost tracking, heuristic fallback).
>
> **On "should it use GPT-5?"** — answered honestly and current in §15.3. Short version: the base **GPT-5 (Aug 2025) is two generations old now**; OpenAI's current flagship is **GPT-5.4 (Mar 2026)**, which folded in Codex-level coding. But the *correct* engineering answer for a portfolio is a **provider-agnostic adapter** (default to a cheap coding-capable model, swappable to Claude/Gemini/local) — never hardcode one vendor. The eval harness lets you *empirically* justify your default, which is itself a great interview story.
>
> **Scope discipline:** The AI feature is **Phase 2**. The MVP still ships and demos fully on the deterministic file-overlap engine alone — the LLM is a strict enhancement with a heuristic fallback, so a budget cap or API outage degrades the product to "Rev 1 behaviour," never to "broken."

---

## Table of Contents

1. Project Overview & Interview Hook
2. Tech Stack (with justification for every choice)
3. MVP Blueprint (6-week plan)
4. System Design — High Level Design (HLD)
5. System Design — Low Level Design (LLD)
6. Database Design & Choice (with comparison matrix)
7. Caching & Messaging — Redis vs Kafka vs RabbitMQ (verdict)
8. Design Patterns Used
9. Docker & Kubernetes Deployment Strategy
10. CI/CD Pipeline (GitHub Actions → DockerHub → EC2/Railway)
11. Monitoring & Observability
12. README Blueprint with Architecture Diagram
13. Interview Prep — Questions & Answers
14. **[NEW] AI Semantic Conflict Analysis — The Differentiator**
15. **[NEW] MLOps Wrapper + GPT-5 / Model Choice Analysis**
16. **[NEW] Resilience Patterns**
17. **[NEW] Availability & Consistency Patterns**
18. **[NEW] Mitigation Strategies (Failure-Mode Table)**
19. **[NEW] Deployment Strategies**
20. Open Source Launch Strategy
21. Deployment Checklist — Go Live

---

## 1. Project Overview & Interview Hook

**Project Name:** PRGraph

**Tagline:** "See which PRs are blocking your team — before you merge the wrong one."

**One-liner:** An open-source PR dependency visualiser that fetches all open PRs for a GitHub repository, builds a file-overlap dependency graph using topological analysis, renders an interactive React Flow diagram showing which PRs can be safely merged now versus which are blocked by conflicting file changes, and sends Slack notifications when a blocker PR is merged — unblocking the dependency chain.

**Interview Hook (memorize this):**

> "I built an open-source tool that solves a pain every engineering team has — PR merge conflicts from file overlaps. It fetches all open PRs from GitHub, builds a directed acyclic graph where edges represent 'PR A blocks PR B because they touch the same files,' uses topological sorting to identify merge-safe PRs, and renders an interactive React Flow diagram. When a blocker PR gets merged, a GitHub webhook triggers re-computation and a Slack bot notifies the team which PRs are now unblocked. I open-sourced it, got real GitHub stars, deployed it with Docker, and documented a scaling decision where I chose Redis over Kafka for the webhook event queue because my event volume didn't justify Kafka's cluster overhead."

**Why interviewers love this:**
- **Product empathy:** Every engineer has felt the pain of merging a PR only to discover it conflicts with 3 others. You identified a real problem and built a tool
- **Graph algorithms:** Topological sort, DAG construction, cycle detection — core CS fundamentals applied practically
- **Open source credibility:** Real GitHub stars, real users, real issues — you can point to adoption metrics
- **Full-stack depth:** GitHub API integration, graph computation, real-time WebSocket updates, Slack bot, interactive visualization
- **DevOps maturity:** Docker, CI/CD, monitoring — production-grade deployment

**Target Companies (Bangalore + Global):**
- **Atlassian** — They build Bitbucket. PR workflow tooling is their bread and butter
- **Linear** — Developer productivity tools. They'll love the product thinking
- **Razorpay, Flipkart** — Large monorepos with PR dependency hell
- **Thoughtworks** — Open source advocacy, clean architecture
- **GitHub/Microsoft** — You're building tooling for their platform
- **Postman, Hasura** — Developer tools companies value DX obsession

---

## 2. Tech Stack — Every Choice Justified

### Core Stack

| Layer | Technology | Why This (Interview Answer) |
|---|---|---|
| **Frontend** | Next.js 16 (App Router) + React 19.2 + TypeScript | SSR for the public landing page (SEO for GitHub discoverability). App Router for server components. TypeScript for type safety across the graph data structures. Next.js 16 is the current stable line (14 is EOL); Turbopack is the default bundler. |
| **Graph Visualization** | React Flow (@xyflow/react) | Purpose-built for node-edge diagrams with pan/zoom/drag. Handles 200+ nodes smoothly. Custom node components for PR cards. Layouting via dagre or ELK algorithms. |
| **UI Framework** | Tailwind CSS + shadcn/ui | Rapid, consistent UI. shadcn gives polished components. Tailwind keeps bundle small — important for a dev tool that should feel snappy. |
| **Backend** | Next.js API Routes + Node.js | For an open-source tool, a unified Next.js deployment is simpler than Spring Boot + React. One repo, one deploy, one Docker image. Reduces contributor friction. |
| **Graph Engine** | Custom TypeScript (graphlib + custom DAG) | Core algorithm is custom: build adjacency list from file overlaps, topological sort to find merge order, cycle detection for deadlocks. graphlib provides primitives. |
| **Real-time** | WebSocket (Socket.IO) | When a webhook fires (PR merged/updated), push graph updates to all connected clients instantly. Socket.IO provides reconnection + fallback for corporate proxies. |
| **Database** | PostgreSQL 16 | See Section 6. Relational integrity for repos/PRs/dependencies. JSONB for flexible GitHub API metadata. Graph edges stored as a junction table — efficient for dependency queries. |
| **Cache** | Redis 7 | GitHub API rate limit management (cache responses), session storage, webhook deduplication, computed graph cache. See Section 7. |
| **GitHub Integration** | GitHub REST API v3 + Webhooks + GitHub App | REST API fetches PRs + file lists. Webhooks push real-time events. GitHub App enables OAuth + per-repo installation. |
| **Slack Integration** | Slack Bolt SDK (Node.js) | Sends notifications when blocker PRs are merged. Bolt SDK is Slack's official Node.js framework — handles OAuth, events, message formatting. |
| **Graph Layout** | dagre (layered layout algorithm) | Automatic positioning of PR nodes in a top-to-bottom dependency hierarchy. Used by React Flow's official examples. |
| **Containerization** | Docker + Docker Compose | Single-image deployment for the full app. Docker Compose for local dev with PostgreSQL + Redis. |
| **CI/CD** | GitHub Actions | Dogfooding — CI/CD on the same platform the tool integrates with. Free for open source repos. |
| **Monitoring** | Prometheus + Grafana | Track GitHub API quota usage, webhook processing latency, graph computation time, active installations. |
| **AI Conflict Analysis (Phase 2)** | Provider-agnostic LLM adapter (default: GPT-5.4-mini; swappable: Claude, Gemini, local Ollama) | Reads diff hunks of two overlapping PRs and decides if they *truly* conflict + explains why. Adapter pattern means no vendor lock-in. See §14, §15. |
| **AI Reliability (Phase 2)** | Eval harness + prompt registry + response cache (Redis) | Gates CI on precision/recall regression, versions prompts, caches LLM verdicts keyed by diff-hash (huge cost saver). See §15. |

### Why NOT These Alternatives (Interview Ammo)

| Rejected Option | Why |
|---|---|
| Spring Boot backend | This is an open-source dev tool. Contributors expect JavaScript/TypeScript. A Java backend increases contribution barrier. Next.js API routes give full-stack in one language with simpler deployment. |
| D3.js for visualization | D3 gives maximum flexibility but requires building pan/zoom/drag/layout from scratch. React Flow provides all of this out-of-the-box with custom node components. For a DAG visualization, React Flow is the right abstraction level. |
| Neo4j (graph database) | Our graph is small (< 500 nodes per repo), recomputed frequently (on every webhook), and ephemeral. Storing it in Neo4j adds operational complexity for a graph that fits in memory. PostgreSQL junction table + in-memory computation is simpler and faster. |
| MongoDB | PR dependencies are inherently relational (PR → touches files → overlaps with PR). Junction tables in PostgreSQL handle this naturally. MongoDB would require embedded arrays or manual $lookup — more complex, less query flexibility. |
| Express.js separately | Running Express separately from Next.js means two processes, two Docker images, CORS configuration, and more complex deployment. Next.js API routes + a WebSocket server sidecar is cleaner. |
| Vis.js / Cytoscape.js | React Flow has better React integration, TypeScript support, and the node/edge model maps perfectly to our PR dependency graph. Vis.js and Cytoscape.js are more canvas-oriented and less React-native. |
| Pusher / Ably (managed WS) | Socket.IO is free, self-hosted, and gives us full control over message routing. A managed service adds cost and a vendor dependency for an open-source project. |

### Why Next.js Full-Stack (Not Spring Boot)?

This is a deliberate, defensible choice. Here's the interview answer:

> "For my previous projects, I used Spring Boot because they targeted enterprise hiring panels. For PRGraph, I chose Next.js full-stack because it's an open-source developer tool. The audience — engineers who will install, use, and contribute — expects a TypeScript codebase they can understand in one sitting. A unified Next.js deployment means one Docker image, one repo, one CI pipeline. This reduces contributor friction dramatically. The backend logic (graph computation, GitHub API calls) is compute-light and I/O-heavy — perfect for Node.js. If this were a high-throughput enterprise service processing millions of webhooks, I'd reach for Spring Boot with virtual threads. But for a tool that handles ~100 webhooks/hour per installation, Next.js is the pragmatic choice."

---

## 3. MVP Blueprint — 6-Week Build Plan

### MVP Scope (What to Build)

**Must Have (MVP):**
- GitHub App installation flow (OAuth + repo selection)
- Fetch all open PRs for a connected repo via GitHub API
- For each PR, fetch list of changed files
- Build file-overlap dependency graph (PR A blocks PR B if they modify the same file)
- Detect dependency type: BLOCKS (same file, overlapping lines), TOUCHES (same file, different sections), INDIRECT (transitive dependency)
- Interactive React Flow visualization with custom PR nodes showing title, author, status, file count
- Color-coded: green (safe to merge), yellow (has dependencies), red (blocked by another PR)
- Topological sort to compute optimal merge order
- Click a PR node → side panel with dependency details, files in conflict, link to GitHub
- GitHub webhook: on PR merge/close/update → recompute graph → push update via WebSocket
- Slack notification: "PR #42 was merged — PR #57 and PR #63 are now unblocked!"
- Public landing page explaining the tool + install button

**Phase 2 — The Differentiator (build after MVP demos cleanly):**
- **AI Semantic Conflict Analysis** — the headline feature. Promote file-level overlap to *semantic* conflict detection: feed the actual diff hunks of two overlapping PRs to an LLM, which decides whether they truly conflict (both edit the same function) or merely co-locate (one edits imports, the other edits a far-away function), and emits a plain-English explanation + suggested resolution. Ships with a strict heuristic fallback so the product never breaks when the LLM is unavailable or over budget. Full design in §14, MLOps wrapper in §15.

**Nice to Have (Post-MVP):**
- Line-level conflict detection (not just file-level) — partly subsumed by the AI feature
- Merge queue suggestion ("merge these 3 PRs in this order")
- Branch protection rule awareness
- CI status overlay (green check / red X on PR nodes)
- GitHub comment bot: "⚠️ This PR conflicts with #42, #57"
- Multi-repo dependency view (monorepo support)
- Dark mode (essential for dev tools)
- Export graph as PNG/SVG

### Week-by-Week Schedule

**Week 1 — Foundation & GitHub Integration**
- Day 1–2: Next.js project scaffold, TypeScript config, Tailwind + shadcn/ui
- Day 3–4: GitHub App creation, OAuth flow (install → authorize → token exchange)
- Day 5: Fetch repos for authenticated user, repo selection UI
- Day 6–7: Fetch all open PRs for selected repo + changed files per PR
- Deliverable: User installs GitHub App, selects repo, sees list of open PRs

**Week 2 — Graph Engine (Core Algorithm)**
- Day 1–2: Build file-overlap adjacency list: for each pair of PRs, compute shared files
- Day 3: Dependency classification: BLOCKS vs TOUCHES vs INDIRECT
- Day 4: Topological sort implementation (Kahn's algorithm) for merge order
- Day 5: Cycle detection (Tarjan's or DFS-based) for deadlock identification
- Day 6–7: Graph data structure: nodes (PRs) + edges (dependencies) + metadata
- Deliverable: Given a list of PRs + files, outputs a dependency graph with merge order

**Week 3 — React Flow Visualization**
- Day 1–2: React Flow setup, custom PR node component (title, author, status, color)
- Day 3: dagre layout engine integration (automatic hierarchical positioning)
- Day 4: Edge styling: red dashed (blocks), yellow dotted (touches), grey (indirect)
- Day 5: Interactive features: click node → side panel with details
- Day 6–7: Merge order overlay, "safe to merge" highlighting, legend
- Deliverable: Interactive dependency graph visible in browser

**Week 4 — Real-time Updates & Webhooks**
- Day 1–2: GitHub webhook endpoint (PR opened, closed, merged, synchronize, edited)
- Day 3: Webhook signature validation (HMAC-SHA256)
- Day 4: On webhook → recompute graph → store updated graph
- Day 5–6: Socket.IO setup — push graph updates to all connected clients
- Day 7: Optimistic UI: show "updating..." indicator during recomputation
- Deliverable: Merge a PR on GitHub → graph updates automatically in the browser

**Week 5 — Slack Bot & Dashboard**
- Day 1–2: Slack App creation, OAuth flow, Slack Bolt SDK integration
- Day 3–4: Notification logic: detect newly unblocked PRs after a merge → send Slack message
- Day 5: Installation dashboard: connected repos, PR count, last sync time
- Day 6: Graph history: "what changed since last computation" diff view
- Day 7: Error handling, loading states, empty states (no PRs, no dependencies)
- Deliverable: Complete feature set with Slack notifications

**Week 6 — DevOps, Polish & Open Source Launch**
- Day 1–2: Dockerfile (multi-stage), docker-compose.yml
- Day 3: GitHub Actions CI/CD → DockerHub → Railway/EC2
- Day 4: Prometheus metrics + Grafana dashboard
- Day 5: README with architecture diagram, screenshots, setup instructions
- Day 6: Open source prep: LICENSE (MIT), CONTRIBUTING.md, issue templates, GitHub Actions badges
- Day 7: Deploy publicly, submit to ProductHunt/HackerNews, record demo video
- Deliverable: Live deployed, open-source tool with real installation link

**Week 7 — AI Semantic Conflict Analysis (Phase 2 Differentiator)**
- Day 1: Provider-agnostic `LLMAdapter` interface + first concrete adapter (OpenAI GPT-5.4-mini)
- Day 2: Prompt registry (versioned prompts as files) + structured JSON output with Zod schema validation
- Day 3: Diff-hunk fetcher (GitHub `GET .../pulls/{n}/files` already returns `patch`) → build the conflict-analysis prompt for a PR pair
- Day 4: Redis response cache keyed by `sha256(promptVersion + diffA + diffB)` — identical pairs never re-hit the API
- Day 5: Wire AI verdict into the graph: edge gets `semanticVerdict: TRUE_CONFLICT | CO_LOCATED | UNCERTAIN` + explanation; heuristic fallback when LLM disabled/over-budget
- Day 6–7: Frontend — edge tooltip shows AI explanation, PR detail panel shows "AI says: these are safe to merge in parallel"
- Deliverable: Toggle "AI analysis" on → edges re-classified with explanations; toggle off → deterministic behaviour

**Week 8 — MLOps Hardening & Eval Harness (Phase 2)**
- Day 1–2: Build a labeled eval set (~40 PR pairs from real repos, hand-labeled TRUE_CONFLICT / CO_LOCATED)
- Day 3: Eval harness — runs the prompt against the set, computes precision/recall/F1 vs labels
- Day 4: Add eval to CI — PR fails if F1 drops below a threshold (regression gate); store results as an artifact
- Day 5: Cost + latency metrics to Prometheus (`llm_tokens_total`, `llm_cost_usd_total`, `llm_latency_ms`, `llm_cache_hit_ratio`), budget circuit breaker
- Day 6: Swap-model experiment — run the same eval against a second provider, document the result in the README (your "model choice" interview story)
- Day 7: Write `docs/AI_ARCHITECTURE.md` + the model-choice decision matrix
- Deliverable: An AI feature you can defend empirically: "I chose model X because it scored F1=0.9 at 1/5th the cost; here's the eval in CI"

---

## 4. High-Level Design (HLD)

### Architecture Overview

```
┌───────────────────┐         ┌───────────────────┐
│   GitHub.com      │         │   Slack            │
│                   │         │                    │
│  ┌─────────────┐  │         │  ┌──────────────┐  │
│  │ Repositories │  │         │  │ #dev-channel  │  │
│  │ (PRs, Files) │  │         │  └──────┬───────┘  │
│  └──────┬──────┘  │         │         ▲          │
│         │         │         │         │          │
│  Webhooks (push)  │         │  Slack Bolt SDK    │
│  REST API (pull)  │         │  (notifications)   │
└─────────┬─────────┘         └─────────┬──────────┘
          │                             │
          ▼                             │
┌─────────────────────────────────────────────────────────┐
│                   NEXT.JS APPLICATION                    │
│                  (Full-Stack Monolith)                    │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                    FRONTEND                          │ │
│  │                                                     │ │
│  │  ┌────────────┐  ┌──────────────┐  ┌────────────┐  │ │
│  │  │ Landing    │  │ Graph View   │  │ Dashboard  │  │ │
│  │  │ Page (SSR) │  │ (React Flow) │  │ (Repos,    │  │ │
│  │  │            │  │ + Side Panel │  │  Settings)  │  │ │
│  │  └────────────┘  └──────────────┘  └────────────┘  │ │
│  │                                                     │ │
│  │  WebSocket Client (Socket.IO) ←── real-time graph   │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                 API ROUTES (Backend)                  │ │
│  │                                                     │ │
│  │  ┌──────────┐ ┌────────────┐ ┌───────────────────┐  │ │
│  │  │ Auth     │ │ Webhook    │ │ Graph Computation │  │ │
│  │  │ (GitHub  │ │ Handler    │ │ Engine            │  │ │
│  │  │  OAuth)  │ │            │ │ (DAG + Topo Sort) │  │ │
│  │  └──────────┘ └────────────┘ └───────────────────┘  │ │
│  │  ┌──────────┐ ┌────────────┐ ┌───────────────────┐  │ │
│  │  │ GitHub   │ │ Slack      │ │ Repo/PR           │  │ │
│  │  │ Service  │ │ Service    │ │ Service            │  │ │
│  │  │ (API +   │ │ (Bolt SDK) │ │ (CRUD)             │  │ │
│  │  │  Octokit)│ │            │ │                    │  │ │
│  │  └──────────┘ └────────────┘ └───────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  Socket.IO Server (sidecar in same process)              │
└──────────────────┬────────────────────┬──────────────────┘
                   │                    │
          ┌────────┴────────┐  ┌────────┴────────┐
          │  PostgreSQL 16  │  │    Redis 7       │
          │                 │  │                  │
          │  - Users        │  │  - GitHub API    │
          │  - Installations│  │    response cache│
          │  - Repos        │  │  - Computed graph│
          │  - PRs          │  │    cache         │
          │  - Dependencies │  │  - Rate limit    │
          │  - PR files     │  │    tracking      │
          │  (junction tbl) │  │  - Webhook dedup │
          └─────────────────┘  │  - Session store │
                               └─────────────────┘
```

### Core Request Flows

**Flow 1: Initial Graph Computation (First Load)**
```
Step 1:  User installs GitHub App → selects repository
    ↓
Step 2:  Backend receives installation token → stores in DB
    ↓
Step 3:  GitHub Service calls: GET /repos/{owner}/{repo}/pulls?state=open
         → Fetches all open PRs (paginated, up to 100 per page)
    ↓
Step 4:  For each PR → GET /repos/{owner}/{repo}/pulls/{number}/files
         → Fetches changed files list (filename + status + additions/deletions)
         → Cache each response in Redis (TTL: 5 min)
    ↓
Step 5:  Graph Engine receives: List<PR> where each PR has List<File>
    ↓
Step 6:  File Overlap Detection:
         For each pair of PRs (A, B):
           shared_files = intersection(A.files, B.files)
           if shared_files is not empty:
             add edge: A → B (BLOCKS) if A was opened first
             add edge: B → A (BLOCKS) if B was opened first
             (configurable: "earlier PR has priority")
    ↓
Step 7:  Graph Analysis:
         a) Topological Sort (Kahn's algorithm) → optimal merge order
         b) Cycle Detection (DFS) → deadlock identification
         c) Node Classification:
            - SAFE (green): no incoming blocking edges
            - DEPENDENT (yellow): has blocking dependencies but no cycles
            - BLOCKED (red): part of a cycle or deep dependency chain
    ↓
Step 8:  Store computed graph in PostgreSQL (nodes + edges)
         + Cache serialized graph in Redis (TTL: 5 min)
    ↓
Step 9:  Return graph JSON → React Flow renders interactive visualization
```

**Flow 2: Real-time Update via Webhook**
```
Step 1:  Developer merges PR #42 on GitHub
    ↓
Step 2:  GitHub fires webhook: POST /api/webhooks/github
         Event: pull_request, Action: closed, merged: true
    ↓
Step 3:  Webhook Handler:
         a) Validate HMAC-SHA256 signature
         b) Check Redis for duplicate delivery (idempotency key)
         c) Parse event: PR #42 merged in repo "acme/backend"
    ↓
Step 4:  Identify affected PRs:
         SELECT pr_id FROM dependencies WHERE blocker_pr_id = 42
         → Returns [PR #57, PR #63] — these were blocked by #42
    ↓
Step 5:  Re-fetch open PRs from GitHub API (or remove #42 from cached data)
    ↓
Step 6:  Recompute dependency graph (Steps 6-8 from Flow 1)
    ↓
Step 7:  Diff old graph vs new graph:
         - Removed: PR #42 (merged)
         - Status changed: PR #57 BLOCKED → SAFE, PR #63 BLOCKED → DEPENDENT
    ↓
Step 8:  Push graph update via Socket.IO to all connected clients:
         { event: "graph_updated", data: newGraph, changes: diff }
    ↓
Step 9:  React Flow animates the transition:
         - PR #42 node fades out
         - PR #57 turns from red to green (pulsing animation)
         - PR #63 turns from red to yellow
    ↓
Step 10: Slack Notification:
         "🎉 PR #42 'Fix auth bug' was merged!
          ✅ PR #57 'Add OAuth2' is now safe to merge
          🔶 PR #63 'Refactor login' still depends on PR #71"
```

**Flow 3: Graph Algorithm — File Overlap DAG Construction**
```
INPUT:
  PR #10: files = [auth.js, utils.js]
  PR #20: files = [auth.js, middleware.js]
  PR #30: files = [utils.js, config.js]
  PR #40: files = [README.md]
  PR #50: files = [middleware.js, auth.js]

STEP 1 — Build File Index (inverted index):
  auth.js       → [PR#10, PR#20, PR#50]
  utils.js      → [PR#10, PR#30]
  middleware.js  → [PR#20, PR#50]
  config.js     → [PR#30]
  README.md     → [PR#40]

STEP 2 — Compute Pairwise Overlaps:
  PR#10 ↔ PR#20: shared=[auth.js]        → EDGE (PR#10 blocks PR#20)
  PR#10 ↔ PR#30: shared=[utils.js]       → EDGE (PR#10 blocks PR#30)
  PR#10 ↔ PR#50: shared=[auth.js]        → EDGE (PR#10 blocks PR#50)
  PR#20 ↔ PR#50: shared=[middleware.js,   → EDGE (PR#20 blocks PR#50)
                          auth.js]
  PR#40: no overlaps                      → INDEPENDENT (safe to merge)

STEP 3 — Build DAG (earlier PR has priority):
  PR#10 ──blocks──→ PR#20
  PR#10 ──blocks──→ PR#30
  PR#10 ──blocks──→ PR#50
  PR#20 ──blocks──→ PR#50

STEP 4 — Topological Sort (merge order):
  Level 0 (safe now): [PR#10, PR#40]  ← no blockers
  Level 1 (after L0):  [PR#20, PR#30] ← blocked only by PR#10
  Level 2 (after L1):  [PR#50]        ← blocked by PR#10 AND PR#20

STEP 5 — Node Classification:
  PR#10: SAFE    (green)  — no incoming edges
  PR#40: SAFE    (green)  — no incoming edges
  PR#20: BLOCKED (yellow) — depends on PR#10
  PR#30: BLOCKED (yellow) — depends on PR#10
  PR#50: BLOCKED (red)    — depends on PR#10 AND PR#20 (deep chain)

OUTPUT → React Flow Graph Data:
  nodes: [{id:'10', status:'safe'}, {id:'20', status:'blocked'}, ...]
  edges: [{source:'10', target:'20', type:'blocks', sharedFiles:['auth.js']}, ...]
```

---

## 5. Low-Level Design (LLD)

### 5.1 Project Structure (Next.js Full-Stack Monolith)

```
prgraph/
├── src/
│   ├── app/                                    # Next.js App Router
│   │   ├── layout.tsx                          # Root layout (nav, theme)
│   │   ├── page.tsx                            # Landing page (SSR, SEO)
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx                  # GitHub OAuth login
│   │   │   └── callback/page.tsx               # OAuth callback handler
│   │   ├── dashboard/
│   │   │   ├── page.tsx                        # Connected repos list
│   │   │   └── settings/page.tsx               # Slack integration, preferences
│   │   ├── repo/
│   │   │   └── [owner]/[name]/
│   │   │       ├── page.tsx                    # Main graph view
│   │   │       └── history/page.tsx            # Graph change history
│   │   └── api/                                # API Routes (Backend)
│   │       ├── auth/
│   │       │   ├── github/route.ts             # Initiate OAuth
│   │       │   └── callback/route.ts           # Exchange code for token
│   │       ├── webhooks/
│   │       │   └── github/route.ts             # Webhook receiver
│   │       ├── repos/
│   │       │   ├── route.ts                    # List connected repos
│   │       │   └── [repoId]/
│   │       │       ├── sync/route.ts           # Trigger manual sync
│   │       │       └── graph/route.ts          # Get current graph
│   │       ├── slack/
│   │       │   ├── install/route.ts            # Slack OAuth
│   │       │   └── events/route.ts             # Slack event handler
│   │       └── health/route.ts                 # Health check endpoint
│   │
│   ├── components/
│   │   ├── graph/
│   │   │   ├── DependencyGraph.tsx             # React Flow wrapper
│   │   │   ├── PRNode.tsx                      # Custom PR node component
│   │   │   ├── DependencyEdge.tsx              # Custom edge (blocks/touches)
│   │   │   ├── GraphLegend.tsx                 # Color legend
│   │   │   ├── MergeOrderPanel.tsx             # Suggested merge sequence
│   │   │   ├── PRDetailPanel.tsx               # Side panel: PR details
│   │   │   ├── ConflictFileList.tsx            # Files causing the conflict
│   │   │   └── GraphControls.tsx               # Zoom, fit, layout toggle
│   │   ├── dashboard/
│   │   │   ├── RepoCard.tsx                    # Connected repo card
│   │   │   ├── InstallationStats.tsx           # PR count, dependency count
│   │   │   └── SyncStatus.tsx                  # Last synced, next sync
│   │   ├── layout/
│   │   │   ├── Navbar.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── ThemeToggle.tsx                 # Dark/light mode
│   │   └── common/
│   │       ├── LoadingSkeleton.tsx
│   │       ├── EmptyState.tsx
│   │       ├── ErrorBoundary.tsx
│   │       └── GitHubAvatar.tsx
│   │
│   ├── lib/                                     # Core business logic
│   │   ├── graph/
│   │   │   ├── buildDependencyGraph.ts         # Core: file overlap → DAG
│   │   │   ├── topologicalSort.ts              # Kahn's algorithm
│   │   │   ├── cycleDetection.ts               # Tarjan's / DFS cycle finder
│   │   │   ├── classifyNodes.ts                # SAFE / BLOCKED / DEADLOCKED
│   │   │   ├── computeMergeOrder.ts            # Optimal merge sequence
│   │   │   ├── diffGraphs.ts                   # Old graph vs new graph
│   │   │   └── types.ts                        # Graph type definitions
│   │   ├── github/
│   │   │   ├── client.ts                       # Octokit wrapper
│   │   │   ├── fetchPRs.ts                     # Paginated PR fetching
│   │   │   ├── fetchPRFiles.ts                 # Files per PR
│   │   │   ├── validateWebhook.ts              # HMAC-SHA256 validation
│   │   │   └── types.ts                        # GitHub API types
│   │   ├── slack/
│   │   │   ├── client.ts                       # Slack Bolt app
│   │   │   ├── formatMessage.ts                # Block Kit message builder
│   │   │   └── notifyUnblocked.ts              # Send unblock notification
│   │   ├── db/
│   │   │   ├── prisma.ts                       # Prisma client singleton
│   │   │   └── queries.ts                      # Complex SQL queries
│   │   ├── cache/
│   │   │   ├── redis.ts                        # Redis client singleton
│   │   │   ├── graphCache.ts                   # Cache computed graphs
│   │   │   └── githubCache.ts                  # Cache GitHub API responses
│   │   └── websocket/
│   │       ├── server.ts                       # Socket.IO server setup
│   │       └── events.ts                       # Event types + handlers
│   │
│   ├── hooks/
│   │   ├── useGraph.ts                         # Fetch + subscribe to graph
│   │   ├── useWebSocket.ts                     # Socket.IO client hook
│   │   ├── useGraphLayout.ts                   # dagre layout computation
│   │   └── useAuth.ts                          # GitHub auth state
│   │
│   └── types/
│       └── index.ts                            # Shared TypeScript types
│
├── prisma/
│   ├── schema.prisma                           # Database schema
│   └── migrations/                             # Auto-generated migrations
│
├── server/
│   └── websocket.ts                            # Socket.IO server (custom server)
│
├── public/
│   ├── og-image.png                            # Open Graph preview
│   └── demo.gif                                # Animated demo for README
│
├── monitoring/
│   ├── prometheus.yml
│   └── grafana/
│       ├── dashboards/
│       └── datasources/
│
├── docker-compose.yml
├── Dockerfile
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                              # Test + lint
│   │   └── deploy.yml                          # Build + deploy
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
├── CONTRIBUTING.md
├── LICENSE                                      # MIT
└── README.md
```

### 5.2 Core Algorithm — buildDependencyGraph.ts

```typescript
// lib/graph/buildDependencyGraph.ts

import { PRWithFiles, DependencyGraph, GraphNode, GraphEdge,
         NodeStatus, EdgeType } from './types';

/**
 * Builds a dependency DAG from a list of PRs and their changed files.
 *
 * Algorithm:
 * 1. Build inverted index: file → [PRs that touch it]
 * 2. For each file touched by 2+ PRs, create BLOCKS edges
 * 3. Edge direction: earlier PR (by creation date) blocks later PR
 * 4. Classify nodes: SAFE (no incoming), BLOCKED (has incoming), DEADLOCKED (in cycle)
 * 5. Compute topological sort for merge order
 */
export function buildDependencyGraph(prs: PRWithFiles[]): DependencyGraph {

  // Step 1: Build inverted index — file → list of PRs touching it
  const fileIndex = new Map<string, PRWithFiles[]>();
  for (const pr of prs) {
    for (const file of pr.files) {
      if (!fileIndex.has(file.filename)) {
        fileIndex.set(file.filename, []);
      }
      fileIndex.get(file.filename)!.push(pr);
    }
  }

  // Step 2: Compute pairwise overlaps → build edges
  const edgeMap = new Map<string, GraphEdge>();  // "source-target" → edge

  for (const [filename, touchingPRs] of fileIndex) {
    if (touchingPRs.length < 2) continue;  // Only 1 PR touches this file

    // For every pair of PRs that touch the same file
    for (let i = 0; i < touchingPRs.length; i++) {
      for (let j = i + 1; j < touchingPRs.length; j++) {
        const [earlier, later] = sortByCreatedAt(touchingPRs[i], touchingPRs[j]);
        const edgeKey = `${earlier.number}-${later.number}`;

        if (edgeMap.has(edgeKey)) {
          // Edge exists — add this file to shared files list
          edgeMap.get(edgeKey)!.sharedFiles.push(filename);
        } else {
          // New edge
          edgeMap.set(edgeKey, {
            id: edgeKey,
            source: String(earlier.number),
            target: String(later.number),
            type: EdgeType.BLOCKS,
            sharedFiles: [filename],
            animated: true,
          });
        }
      }
    }
  }

  const edges = Array.from(edgeMap.values());

  // Step 3: Classify edge type based on overlap severity
  for (const edge of edges) {
    if (edge.sharedFiles.length >= 3) {
      edge.type = EdgeType.CRITICAL_BLOCK;  // High conflict
    } else if (edge.sharedFiles.length === 1) {
      edge.type = EdgeType.TOUCHES;  // Low conflict
    }
    // Default: BLOCKS (2 shared files)
  }

  // Step 4: Build nodes with status
  const incomingCount = new Map<string, number>();
  for (const pr of prs) {
    incomingCount.set(String(pr.number), 0);
  }
  for (const edge of edges) {
    incomingCount.set(
      edge.target,
      (incomingCount.get(edge.target) || 0) + 1
    );
  }

  // Step 5: Detect cycles (for DEADLOCKED classification)
  const cycles = detectCycles(prs, edges);
  const nodesInCycles = new Set(cycles.flat());

  // Step 6: Create graph nodes
  const nodes: GraphNode[] = prs.map(pr => ({
    id: String(pr.number),
    data: {
      prNumber: pr.number,
      title: pr.title,
      author: pr.user.login,
      authorAvatar: pr.user.avatar_url,
      createdAt: pr.created_at,
      filesChanged: pr.files.length,
      additions: pr.files.reduce((sum, f) => sum + f.additions, 0),
      deletions: pr.files.reduce((sum, f) => sum + f.deletions, 0),
      htmlUrl: pr.html_url,
      status: classifyNode(String(pr.number), incomingCount, nodesInCycles),
      blockedBy: edges
        .filter(e => e.target === String(pr.number))
        .map(e => e.source),
      blocking: edges
        .filter(e => e.source === String(pr.number))
        .map(e => e.target),
    },
    type: 'prNode',  // Custom React Flow node type
    position: { x: 0, y: 0 },  // dagre will set this
  }));

  // Step 7: Compute merge order via topological sort
  const mergeOrder = topologicalSort(nodes, edges);

  return {
    nodes,
    edges,
    mergeOrder,
    cycles,
    stats: {
      totalPRs: prs.length,
      safePRs: nodes.filter(n => n.data.status === 'SAFE').length,
      blockedPRs: nodes.filter(n => n.data.status === 'BLOCKED').length,
      deadlockedPRs: nodes.filter(n => n.data.status === 'DEADLOCKED').length,
      totalDependencies: edges.length,
    },
  };
}

function classifyNode(
  nodeId: string,
  incomingCount: Map<string, number>,
  nodesInCycles: Set<string>
): NodeStatus {
  if (nodesInCycles.has(nodeId)) return 'DEADLOCKED';
  if ((incomingCount.get(nodeId) || 0) === 0) return 'SAFE';
  return 'BLOCKED';
}

function sortByCreatedAt(a: PRWithFiles, b: PRWithFiles): [PRWithFiles, PRWithFiles] {
  return new Date(a.created_at) < new Date(b.created_at) ? [a, b] : [b, a];
}
```

### 5.3 Topological Sort — Kahn's Algorithm

```typescript
// lib/graph/topologicalSort.ts

export function topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): MergeOrder {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Build adjacency + count in-degrees
  for (const edge of edges) {
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  const levels: string[][] = [];

  // Seed with zero in-degree nodes (safe to merge NOW)
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  while (queue.length > 0) {
    const currentLevel = [...queue];
    levels.push(currentLevel);
    queue.length = 0;  // Clear queue

    for (const nodeId of currentLevel) {
      for (const neighbor of adjacency.get(nodeId) || []) {
        inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }
  }

  // Any remaining nodes with in-degree > 0 are in cycles
  const processed = new Set(levels.flat());
  const inCycle = nodes
    .filter(n => !processed.has(n.id))
    .map(n => n.id);

  return {
    levels,    // [[PR#10, PR#40], [PR#20, PR#30], [PR#50]]
    inCycle,   // PRs that can NEVER be resolved without manual intervention
    totalLevels: levels.length,
  };
}
```

### 5.4 Custom React Flow PR Node Component

```typescript
// components/graph/PRNode.tsx

import { Handle, Position, NodeProps } from '@xyflow/react';
import { GitPullRequest, FileCode, AlertTriangle, CheckCircle } from 'lucide-react';

const statusColors = {
  SAFE: { bg: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-700', icon: '🟢' },
  BLOCKED: { bg: 'bg-amber-50', border: 'border-amber-500', text: 'text-amber-700', icon: '🟡' },
  DEADLOCKED: { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-700', icon: '🔴' },
};

export function PRNode({ data, selected }: NodeProps<PRNodeData>) {
  const colors = statusColors[data.status];

  return (
    <div className={`
      w-72 rounded-lg border-2 ${colors.border} ${colors.bg}
      shadow-md hover:shadow-lg transition-shadow cursor-pointer
      ${selected ? 'ring-2 ring-blue-500' : ''}
    `}>
      {/* Incoming handle (top) */}
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
        <span className="text-lg">{colors.icon}</span>
        <GitPullRequest className="w-4 h-4 text-gray-600" />
        <span className="font-semibold text-gray-900">#{data.prNumber}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} font-medium`}>
          {data.status}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-sm font-medium text-gray-800 line-clamp-2">{data.title}</p>
        <div className="flex items-center gap-2 mt-2">
          <img src={data.authorAvatar} className="w-5 h-5 rounded-full" alt="" />
          <span className="text-xs text-gray-500">{data.author}</span>
        </div>
      </div>

      {/* Footer stats */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 rounded-b-lg text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <FileCode className="w-3 h-3" />
          {data.filesChanged} files
        </span>
        <span className="text-green-600">+{data.additions}</span>
        <span className="text-red-600">-{data.deletions}</span>
        {data.blockedBy.length > 0 && (
          <span className="flex items-center gap-1 text-amber-600">
            <AlertTriangle className="w-3 h-3" />
            {data.blockedBy.length} blockers
          </span>
        )}
      </div>

      {/* Outgoing handle (bottom) */}
      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}
```

### 5.5 Key API Endpoints

```
AUTH
  GET    /api/auth/github               # Redirect to GitHub OAuth
  GET    /api/auth/callback             # Exchange code for token
  GET    /api/auth/me                   # Current user + installations
  POST   /api/auth/logout               # Clear session

REPOS
  GET    /api/repos                     # List connected repos
  POST   /api/repos/:repoId/sync       # Trigger manual PR sync
  DELETE /api/repos/:repoId             # Disconnect repo

GRAPH
  GET    /api/repos/:repoId/graph       # Get current dependency graph
  GET    /api/repos/:repoId/graph/history  # Graph change log
  GET    /api/repos/:repoId/graph/merge-order  # Optimal merge sequence
  GET    /api/repos/:repoId/graph/stats  # Dependency statistics

WEBHOOKS
  POST   /api/webhooks/github           # GitHub event receiver

SLACK
  GET    /api/slack/install             # Slack OAuth redirect
  POST   /api/slack/events              # Slack event handler

HEALTH
  GET    /api/health                    # Health check (for Docker/K8s)

WEBSOCKET (Socket.IO, not REST)
  EVENT  graph:updated                  # Server → Client: graph recomputed
  EVENT  pr:merged                      # Server → Client: specific PR merged
  EVENT  graph:subscribe                # Client → Server: watch a repo
  EVENT  graph:unsubscribe              # Client → Server: stop watching
```

---

## 6. Database Design & Choice

### 6.1 Comparison Matrix — Which Database?

| Criteria | PostgreSQL 16 | MongoDB | Neo4j | Cassandra | TimescaleDB | CosmosDB |
|---|---|---|---|---|---|---|
| **Data Model** | Relational (users → repos → PRs → deps) | Document | Graph (native) | Wide-column | Time-series on Postgres | Multi-model |
| **Graph Storage** | Junction table (dependency edges) | Embedded arrays or $lookup | Native nodes + edges | Not suited | Same as Postgres | Gremlin API |
| **Graph Queries** | SQL JOINs on junction table | Aggregation pipeline | Cypher — native graph traversal | No | Same as Postgres | Gremlin |
| **Our Graph Size** | < 500 nodes per repo. Trivial for SQL JOINs | Works but no advantage | Designed for millions of nodes. Overkill | Fundamentally wrong tool | Overkill | Overkill |
| **Relational Data** | Native (users, repos, installations, config) | Manual $lookup | No relational model | Limited | Same as Postgres | SQL API possible |
| **JSONB** | Excellent (GitHub API metadata) | Native document model | Limited | No | Same as Postgres | Native |
| **ACID** | Full | Single-doc | Full | Eventual | Full | Configurable |
| **Operational Cost** | Low (single instance) | Medium | High (separate DB for graph + relational) | High (3+ nodes) | Low | High (cloud-only) |
| **Open Source Friendly** | Free forever | Free (Community) | Community Edition (limited) | Free | Free | Azure-locked |

### VERDICT: PostgreSQL 16

**Why PostgreSQL wins for PRGraph:**

1. **Our graph is small and ephemeral:** A typical repo has 10-50 open PRs. Even a massive monorepo has < 500. This graph fits trivially in memory and in a simple SQL junction table. Neo4j's native graph storage is designed for social networks with millions of nodes and complex multi-hop traversals — using it for 50 nodes is like using a jet engine to power a bicycle.

2. **Graph computation happens in memory, not in the DB:** We fetch PRs + files, build the graph in TypeScript, run topological sort and cycle detection in-memory, then store the result. The database is for persistence and retrieval, not for graph traversal. PostgreSQL's junction table (pr_dependencies) stores edges efficiently and JOINs answer "what blocks PR #42?" in < 1ms.

3. **Most of our data is relational:** Users → GitHub installations → repositories → pull requests → files → dependencies → notification preferences. This is a textbook relational schema. MongoDB would force denormalization or $lookup chains. Neo4j would handle the graph edges but struggle with the relational configuration data.

4. **JSONB for GitHub API flexibility:** GitHub's API returns rich metadata that varies per PR (labels, reviewers, checks). JSONB columns store this without rigid schema, while remaining queryable.

5. **Open source simplicity:** An open-source tool should be easy to self-host. PostgreSQL is universally available, free, and every developer knows it. Adding Neo4j as a second database doubles the deployment complexity and contributor barrier.

**Why NOT Neo4j?**

> Interview answer: "I considered Neo4j because we're building a graph, but the graph is 10-50 nodes per repo — trivially small. Our graph is recomputed from scratch on every webhook event and lives in memory during computation. The database just persists the result. Neo4j's value is in complex multi-hop traversals across millions of nodes (social networks, recommendation engines). For our use case, a PostgreSQL junction table with 2 JOINs gives the same answer in < 1ms. Adding Neo4j would double our Docker Compose services and contributor setup friction for zero performance benefit."

### 6.2 Schema Design (Prisma ORM)

```prisma
// prisma/schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// GitHub OAuth users
model User {
  id            Int            @id @default(autoincrement())
  githubId      Int            @unique @map("github_id")
  username      String
  email         String?
  avatarUrl     String?        @map("avatar_url")
  accessToken   String         @map("access_token")  // encrypted
  installations Installation[]
  createdAt     DateTime       @default(now()) @map("created_at")
  updatedAt     DateTime       @updatedAt @map("updated_at")

  @@map("users")
}

// GitHub App installations (per user per org/account)
model Installation {
  id                Int          @id @default(autoincrement())
  userId            Int          @map("user_id")
  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  githubInstallId   Int          @unique @map("github_install_id")
  accountLogin      String       @map("account_login")      // org or user name
  accountType       String       @map("account_type")        // "Organization" or "User"
  repositories      Repository[]
  createdAt         DateTime     @default(now()) @map("created_at")

  @@map("installations")
}

// Connected repositories
model Repository {
  id                Int              @id @default(autoincrement())
  installationId    Int              @map("installation_id")
  installation      Installation     @relation(fields: [installationId], references: [id], onDelete: Cascade)
  githubRepoId      Int              @map("github_repo_id")
  fullName          String           @map("full_name")           // "owner/repo"
  defaultBranch     String           @default("main") @map("default_branch")
  isActive          Boolean          @default(true) @map("is_active")
  lastSyncAt        DateTime?        @map("last_sync_at")
  pullRequests      PullRequest[]
  graphSnapshots    GraphSnapshot[]
  slackConfig       SlackConfig?
  createdAt         DateTime         @default(now()) @map("created_at")

  @@unique([installationId, githubRepoId])
  @@map("repositories")
}

// Open pull requests (cached from GitHub API)
model PullRequest {
  id              Int              @id @default(autoincrement())
  repoId          Int              @map("repo_id")
  repository      Repository       @relation(fields: [repoId], references: [id], onDelete: Cascade)
  githubPrId      Int              @map("github_pr_id")
  number          Int                                           // PR #number
  title           String
  authorLogin     String           @map("author_login")
  authorAvatar    String?          @map("author_avatar")
  state           String           @default("open")             // open, closed, merged
  htmlUrl         String           @map("html_url")
  additions       Int              @default(0)
  deletions       Int              @default(0)
  prCreatedAt     DateTime         @map("pr_created_at")
  prUpdatedAt     DateTime         @map("pr_updated_at")
  metadata        Json             @default("{}")               // Labels, reviewers, checks
  files           PRFile[]
  blockedByEdges  Dependency[]     @relation("blocked_pr")      // Edges where this PR is blocked
  blockingEdges   Dependency[]     @relation("blocker_pr")      // Edges where this PR blocks others
  createdAt       DateTime         @default(now()) @map("created_at")
  updatedAt       DateTime         @updatedAt @map("updated_at")

  @@unique([repoId, number])
  @@index([repoId, state])
  @@map("pull_requests")
}

// Files changed in each PR
model PRFile {
  id              Int          @id @default(autoincrement())
  prId            Int          @map("pr_id")
  pullRequest     PullRequest  @relation(fields: [prId], references: [id], onDelete: Cascade)
  filename        String                                        // "src/auth/login.ts"
  status          String                                        // added, modified, removed, renamed
  additions       Int          @default(0)
  deletions       Int          @default(0)

  @@index([prId])
  @@index([filename])                                           // For file overlap queries
  @@map("pr_files")
}

// Computed dependency edges (junction table — the "graph")
model Dependency {
  id              Int          @id @default(autoincrement())
  repoId          Int          @map("repo_id")
  blockerPrId     Int          @map("blocker_pr_id")            // Source: PR that blocks
  blockedPrId     Int          @map("blocked_pr_id")            // Target: PR that is blocked
  blockerPr       PullRequest  @relation("blocker_pr", fields: [blockerPrId], references: [id], onDelete: Cascade)
  blockedPr       PullRequest  @relation("blocked_pr", fields: [blockedPrId], references: [id], onDelete: Cascade)
  edgeType        String       @map("edge_type")                // BLOCKS, TOUCHES, CRITICAL_BLOCK
  sharedFiles     String[]     @map("shared_files")             // Array of conflicting filenames
  computedAt      DateTime     @default(now()) @map("computed_at")

  @@unique([blockerPrId, blockedPrId])
  @@index([repoId])
  @@index([blockerPrId])
  @@index([blockedPrId])
  @@map("dependencies")
}

// Graph computation history (for change tracking)
model GraphSnapshot {
  id              Int          @id @default(autoincrement())
  repoId          Int          @map("repo_id")
  repository      Repository   @relation(fields: [repoId], references: [id], onDelete: Cascade)
  totalPRs        Int          @map("total_prs")
  safePRs         Int          @map("safe_prs")
  blockedPRs      Int          @map("blocked_prs")
  deadlockedPRs   Int          @map("deadlocked_prs")
  totalEdges      Int          @map("total_edges")
  mergeOrder      Json         @map("merge_order")              // Serialized level array
  triggeredBy     String       @map("triggered_by")             // "webhook:pr_merged:42" or "manual_sync"
  computeTimeMs   Int          @map("compute_time_ms")
  graphJson       Json         @map("graph_json")               // Full serialized graph (for replay)
  createdAt       DateTime     @default(now()) @map("created_at")

  @@index([repoId, createdAt(sort: Desc)])
  @@map("graph_snapshots")
}

// Slack integration configuration per repo
model SlackConfig {
  id              Int          @id @default(autoincrement())
  repoId          Int          @unique @map("repo_id")
  repository      Repository   @relation(fields: [repoId], references: [id], onDelete: Cascade)
  teamId          String       @map("team_id")
  channelId       String       @map("channel_id")
  channelName     String       @map("channel_name")
  botToken        String       @map("bot_token")                // encrypted
  isActive        Boolean      @default(true) @map("is_active")
  notifyOnMerge   Boolean      @default(true) @map("notify_on_merge")
  notifyOnUnblock Boolean      @default(true) @map("notify_on_unblock")
  createdAt       DateTime     @default(now()) @map("created_at")

  @@map("slack_configs")
}
```

### 6.3 Key Queries

```sql
-- 1. Get all file overlaps between open PRs in a repo
-- (This is the input to the graph algorithm)
SELECT pf1.pr_id AS pr_a, pf2.pr_id AS pr_b, pf1.filename AS shared_file
FROM pr_files pf1
JOIN pr_files pf2 ON pf1.filename = pf2.filename AND pf1.pr_id < pf2.pr_id
JOIN pull_requests pr1 ON pf1.pr_id = pr1.id AND pr1.state = 'open'
JOIN pull_requests pr2 ON pf2.pr_id = pr2.id AND pr2.state = 'open'
WHERE pr1.repo_id = ?
ORDER BY pf1.filename;

-- 2. What PRs are blocked by PR #42?
SELECT pr.number, pr.title, d.shared_files, d.edge_type
FROM dependencies d
JOIN pull_requests pr ON d.blocked_pr_id = pr.id
WHERE d.blocker_pr_id = (SELECT id FROM pull_requests WHERE repo_id = ? AND number = 42);

-- 3. What blocks PR #57?
SELECT pr.number, pr.title, d.shared_files, d.edge_type
FROM dependencies d
JOIN pull_requests pr ON d.blocker_pr_id = pr.id
WHERE d.blocked_pr_id = (SELECT id FROM pull_requests WHERE repo_id = ? AND number = 57);

-- 4. Graph stats over time (for dashboard)
SELECT date_trunc('day', created_at) AS day,
       AVG(safe_prs) AS avg_safe,
       AVG(blocked_prs) AS avg_blocked,
       AVG(compute_time_ms) AS avg_compute_ms
FROM graph_snapshots
WHERE repo_id = ?
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day;

-- 5. Most frequently conflicting files (insights)
SELECT filename, COUNT(*) AS conflict_count
FROM pr_files pf
WHERE pf.pr_id IN (
  SELECT DISTINCT blocker_pr_id FROM dependencies WHERE repo_id = ?
  UNION
  SELECT DISTINCT blocked_pr_id FROM dependencies WHERE repo_id = ?
)
GROUP BY filename
ORDER BY conflict_count DESC
LIMIT 10;
```

---

## 7. Caching & Messaging — Redis vs Kafka vs RabbitMQ

### 7.1 Comparison for THIS Project

| Criteria | Redis 7 (Cache + Streams) | Apache Kafka | RabbitMQ | ZooKeeper |
|---|---|---|---|---|
| **Primary Purpose** | Multi-tool: cache + queue + dedup + rate track | Distributed event log | Message broker | Coordination (NOT a queue) |
| **GitHub API Cache** | Native (GET cache with TTL) | Not a cache | Not a cache | Not a cache |
| **Webhook Dedup** | SET NX (idempotency key) | Consumer offsets (complex) | Message dedup (limited) | N/A |
| **Rate Limit Tracking** | INCR + EXPIRE (sliding window) | Not designed for this | Not designed for this | N/A |
| **Event Queue** | Redis Streams (ack + consumer groups) | Overkill for ~100 events/hr | Good but extra service | N/A |
| **Graph Cache** | Perfect (store serialized JSON, TTL 5 min) | N/A | N/A | N/A |
| **Operational Complexity** | Very Low (single binary, 50MB) | High (3 brokers + ZK, 4GB+) | Medium (Erlang, 200MB) | Used BY Kafka |
| **Open Source Deploy** | docker pull redis:7-alpine — done | 3+ containers minimum | 1 container + config | Not standalone |

### VERDICT: Redis 7 — Single Tool for 5 Purposes

**Purpose 1 — GitHub API Response Cache (CRITICAL for rate limits)**
```
GitHub REST API allows 5,000 requests/hour per installation.
Fetching 50 PRs + files for each = 51 API calls PER SYNC.
10 syncs/hour = 510 calls → close to limit on busy repos.

Cache strategy:
Key: "gh:prs:{repoId}"               → Cached PR list (TTL: 2 min)
Key: "gh:files:{repoId}:{prNumber}"   → Cached file list per PR (TTL: 5 min)
Key: "gh:ratelimit:{installId}"       → Remaining API calls (updated per response header)

Cache-first approach:
- On webhook → only re-fetch CHANGED PR's files, serve rest from cache
- On manual sync → fetch all, but respect If-None-Match (GitHub ETag support)
```

**Purpose 2 — Computed Graph Cache**
```
Key: "graph:{repoId}"                → Serialized DependencyGraph JSON (TTL: 5 min)
Key: "graph:version:{repoId}"        → Incrementing version counter

When a client connects, it receives the cached graph instantly.
On webhook → invalidate cache → recompute → store new graph → push via WebSocket.
Clients that connect DURING recomputation get the stale (but valid) cached version.
```

**Purpose 3 — Webhook Deduplication**
```
GitHub sometimes sends duplicate webhook deliveries.
On webhook receive:

Key: "webhook:dedup:{deliveryId}"     → "1" (TTL: 300 seconds)

SET NX (set if not exists):
  - If set succeeds → first delivery, process it
  - If set fails → duplicate, skip it
```

**Purpose 4 — WebSocket Room Management**
```
Key: "ws:repo:{repoId}:clients"      → Set of connected Socket.IO client IDs

When a webhook triggers recomputation:
  1. Check if any clients are watching this repo
  2. If yes → recompute and push
  3. If no → recompute in background (no urgency)

This prevents wasting compute on repos nobody is actively viewing.
```

**Purpose 5 — Webhook Processing Queue (Redis Streams)**
```
Stream: "webhook-events"

Producer: Webhook handler on receive:
  XADD webhook-events * type pr_merged repoId 42 prNumber 57 installId 7

Consumer: Graph computation worker:
  XREADGROUP GROUP graph-workers worker-1 COUNT 5 BLOCK 5000 STREAMS webhook-events >

Processing:
  1. Fetch updated PR data from GitHub (or cache)
  2. Recompute dependency graph
  3. Diff with previous graph → identify newly unblocked PRs
  4. Push update via Socket.IO
  5. Send Slack notification if configured
  6. XACK webhook-events graph-workers {messageId}

Why queue instead of processing synchronously?
  - Webhook endpoint must respond 200 within 10 seconds (GitHub requirement)
  - Graph computation + GitHub API calls can take 5-15 seconds
  - Queue decouples receipt from processing → always fast webhook response
```

**Why NOT Kafka?**

> "An open-source dev tool that handles ~100 webhook events per hour per installation doesn't need a distributed event log with partition replication across 3+ JVM brokers. Redis Streams gives me consumer groups, message acknowledgment, and pending message monitoring with the same Redis instance I already run for caching and deduplication. If PRGraph were a managed SaaS processing webhooks for 10,000 repositories simultaneously, Kafka's partitioned consumer model would be justified. At current scale, it would be like running a Kubernetes cluster to serve a static website."

**Why NOT RabbitMQ?**

> "RabbitMQ would be a reasonable choice for the webhook queue alone, but Redis already handles 4 of my 5 needs (API cache, graph cache, deduplication, rate tracking). Adding RabbitMQ means an additional Erlang-based container in docker-compose, a separate management UI, and more documentation for contributors. Using Redis Streams for the 5th need eliminates an entire service."

**Why NOT ZooKeeper?**

> "ZooKeeper is not a message queue or cache. It's a distributed coordination service used by Kafka (pre-KRaft) for broker metadata and leader election. It has no relevance as a standalone tool for application-level caching or messaging. This is a common misconception I can clarify."

---

## 8. Design Patterns Used

### 8.1 Observer Pattern (Webhook Event Propagation)

**Where:** When a GitHub webhook fires, multiple systems react independently.

```typescript
// lib/events/eventBus.ts
type EventHandler = (payload: any) => Promise<void>;

class EventBus {
  private handlers = new Map<string, EventHandler[]>();

  on(event: string, handler: EventHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler);
  }

  async emit(event: string, payload: any) {
    const handlers = this.handlers.get(event) || [];
    await Promise.allSettled(handlers.map(h => h(payload)));
  }
}

// Registration
eventBus.on('pr:merged', graphRecomputeHandler);    // Recompute dependency graph
eventBus.on('pr:merged', slackNotifyHandler);        // Send Slack notification
eventBus.on('pr:merged', websocketPushHandler);      // Push update to clients
eventBus.on('pr:merged', snapshotHandler);           // Save graph snapshot
eventBus.on('pr:merged', cacheInvalidateHandler);    // Clear stale caches
```

**Why:** Decouples webhook receipt from all downstream effects. Adding a new side effect (email notification, Discord bot, audit log) = register one more handler. Zero changes to webhook controller.

### 8.2 Strategy Pattern (Graph Layout Algorithms)

**Where:** Users can switch between different graph layout styles.

```typescript
interface LayoutStrategy {
  computeLayout(nodes: GraphNode[], edges: GraphEdge[]): PositionedGraph;
}

class DagreHierarchicalLayout implements LayoutStrategy {
  // Top-to-bottom hierarchical (default — shows dependency layers)
  computeLayout(nodes, edges) { /* dagre TB layout */ }
}

class DagreLeftToRightLayout implements LayoutStrategy {
  // Left-to-right (better for wide monitors)
  computeLayout(nodes, edges) { /* dagre LR layout */ }
}

class ForceDirectedLayout implements LayoutStrategy {
  // Physics-based (shows clusters naturally)
  computeLayout(nodes, edges) { /* d3-force simulation */ }
}

// Usage
const layoutStrategies: Record<string, LayoutStrategy> = {
  hierarchy: new DagreHierarchicalLayout(),
  horizontal: new DagreLeftToRightLayout(),
  force: new ForceDirectedLayout(),
};

function layoutGraph(graph: DependencyGraph, strategy: string): PositionedGraph {
  return layoutStrategies[strategy].computeLayout(graph.nodes, graph.edges);
}
```

### 8.3 Builder Pattern (Slack Message Construction)

**Where:** Building rich Slack Block Kit messages with variable sections.

```typescript
class SlackMessageBuilder {
  private blocks: any[] = [];

  withHeader(text: string) {
    this.blocks.push({ type: 'header', text: { type: 'plain_text', text } });
    return this;
  }

  withMergedPR(pr: { number: number; title: string; author: string }) {
    this.blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `✅ *PR #${pr.number}* _${pr.title}_ by ${pr.author} was merged` }
    });
    return this;
  }

  withUnblockedPRs(prs: { number: number; title: string }[]) {
    if (prs.length === 0) return this;
    const prList = prs.map(p => `• <${p.htmlUrl}|#${p.number}> ${p.title}`).join('\n');
    this.blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `🎉 *Now safe to merge:*\n${prList}` }
    });
    return this;
  }

  withStillBlocked(count: number) {
    if (count === 0) return this;
    this.blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🔶 ${count} PRs still have dependencies` }]
    });
    return this;
  }

  withGraphLink(url: string) {
    this.blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '📊 View Dependency Graph' },
        url,
        style: 'primary'
      }]
    });
    return this;
  }

  build() { return { blocks: this.blocks }; }
}

// Usage:
const message = new SlackMessageBuilder()
  .withHeader('PR Dependency Update')
  .withMergedPR({ number: 42, title: 'Fix auth bug', author: 'alice' })
  .withUnblockedPRs([
    { number: 57, title: 'Add OAuth2' },
    { number: 63, title: 'Refactor login' }
  ])
  .withStillBlocked(3)
  .withGraphLink('https://prgraph.dev/repo/acme/backend')
  .build();
```

### 8.4 Command Pattern (Graph Operations)

**Where:** Each graph operation (recompute, diff, export) is encapsulated as a command object with undo/logging capability.

```typescript
interface GraphCommand {
  execute(): Promise<GraphResult>;
  describe(): string;  // For audit logging
}

class RecomputeGraphCommand implements GraphCommand {
  constructor(private repoId: number, private trigger: string) {}

  async execute(): Promise<GraphResult> {
    const prs = await fetchPRsWithFiles(this.repoId);
    const graph = buildDependencyGraph(prs);
    await persistGraph(this.repoId, graph);
    await cacheGraph(this.repoId, graph);
    return graph;
  }

  describe() { return `Recompute graph for repo ${this.repoId} (trigger: ${this.trigger})`; }
}

class DiffGraphCommand implements GraphCommand {
  constructor(private repoId: number, private oldSnapshotId: number) {}

  async execute(): Promise<GraphDiff> {
    const oldGraph = await getSnapshot(this.oldSnapshotId);
    const newGraph = await getCurrentGraph(this.repoId);
    return diffGraphs(oldGraph, newGraph);
  }

  describe() { return `Diff graph for repo ${this.repoId} against snapshot ${this.oldSnapshotId}`; }
}
```

### 8.5 Circuit Breaker (GitHub + Slack API Resilience)

**Where:** External API calls that can fail or rate limit.

```typescript
// Using opossum (Node.js circuit breaker library)
import CircuitBreaker from 'opossum';

const githubBreaker = new CircuitBreaker(fetchFromGitHub, {
  timeout: 10000,           // 10 second timeout
  errorThresholdPercentage: 50,  // Open after 50% failures
  resetTimeout: 30000,      // Try again after 30 seconds
  volumeThreshold: 5,       // Minimum 5 calls before evaluating
});

githubBreaker.fallback(() => {
  // Return cached data when GitHub is down
  return getCachedPRData(repoId);
});

githubBreaker.on('open', () => {
  logger.warn('GitHub API circuit OPEN — using cached data');
  metrics.increment('circuit_breaker.github.open');
});
```

### 8.6 Decorator Pattern (API Response Caching)

**Where:** Wrapping GitHub API calls with transparent caching.

```typescript
function withCache<T>(
  keyFn: (...args: any[]) => string,
  ttlSeconds: number
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cacheKey = keyFn(...args);
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const result = await originalMethod.apply(this, args);
      await redis.setex(cacheKey, ttlSeconds, JSON.stringify(result));
      return result;
    };
  };
}

class GitHubService {
  @withCache((repoId) => `gh:prs:${repoId}`, 120)  // 2 min cache
  async fetchOpenPRs(repoId: number): Promise<PR[]> {
    return octokit.pulls.list({ owner, repo, state: 'open' });
  }

  @withCache((repoId, prNum) => `gh:files:${repoId}:${prNum}`, 300)  // 5 min cache
  async fetchPRFiles(repoId: number, prNum: number): Promise<PRFile[]> {
    return octokit.pulls.listFiles({ owner, repo, pull_number: prNum });
  }
}
```

### 8.7 Pub/Sub Pattern (WebSocket Graph Updates)

**Where:** Multiple clients watching the same repo receive updates simultaneously.

```typescript
// Socket.IO room-based pub/sub
io.on('connection', (socket) => {
  socket.on('graph:subscribe', async (repoId: string) => {
    socket.join(`repo:${repoId}`);
    // Send current graph immediately
    const graph = await getCachedOrComputeGraph(repoId);
    socket.emit('graph:current', graph);
  });

  socket.on('graph:unsubscribe', (repoId: string) => {
    socket.leave(`repo:${repoId}`);
  });
});

// After recomputing graph (triggered by webhook):
function pushGraphUpdate(repoId: string, graph: DependencyGraph, diff: GraphDiff) {
  io.to(`repo:${repoId}`).emit('graph:updated', { graph, diff, timestamp: Date.now() });
}
```

### 8.8 Event-Driven Architecture (Overall Flow)

```
GitHub Webhook Event
    │
    ├──→ [Redis Stream: webhook-events]
    │         │
    │    Graph Worker picks up event
    │         │
    │         ├──→ GitHub Service (fetch updated data, cache-first)
    │         │
    │         ├──→ Graph Engine (recompute DAG, topo sort, classify)
    │         │
    │         ├──→ PostgreSQL (persist graph + snapshot)
    │         │
    │         ├──→ Redis (cache new graph, invalidate old)
    │         │
    │         ├──→ Socket.IO (push to connected clients)
    │         │
    │         └──→ Slack Service (notify unblocked PRs)
    │
    └──→ Webhook endpoint returns 200 immediately (< 1 second)
```

---

## 9. Docker & Kubernetes Deployment Strategy

### 9.1 Dockerfile (Multi-stage, Single Image)

**Why this image does *not* use `output: 'standalone'`.** PRGraph runs a **custom server**
(`server/websocket.ts`) that hosts the Next.js request handler **and** the Socket.IO server in one
process. Next's `output: 'standalone'` is incompatible with that: it emits its *own* minimal
`.next/standalone/server.js` (the equivalent of `next start`) which has no Socket.IO, and its traced
`node_modules` omits `socket.io` / `@socket.io/redis-adapter` because the custom server sits outside
Next's build graph. Running `node server.js` from the standalone output would therefore serve the
app **without** real-time updates. We keep the "one image, one process" goal but build it correctly:
ship a normal `.next` build, a production `node_modules`, and the **custom server compiled to a
single ESM file**, then run that.

Three things make this work, declared in `next.config.ts` and `package.json`:

```ts
// next.config.ts — do NOT set output:'standalone' for the custom-server deployment.
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  // output: 'standalone',   // ← intentionally omitted: standalone excludes the Socket.IO server
  // reactCompiler: true,    // optional (stable in 16, off by default; adds build time)
};
export default nextConfig;
```

```jsonc
// package.json — custom-server scripts (no --turbopack flag in Next.js 16)
{
  "scripts": {
    "dev": "tsx watch server/websocket.ts",          // Turbopack engaged via next({ dev:true })
    "build": "next build",                            // → .next  (Turbopack is the default bundler)
    "build:server": "esbuild server/websocket.ts --bundle --platform=node --format=esm --target=node24 --packages=external --outfile=dist/server.mjs",
    "start": "node dist/server.mjs",                  // the compiled custom server, NOT .next/standalone
    "lint": "eslint ."                                // next lint was removed in 16
  },
  "dependencies": {
    "prisma": "^6"                                    // CLI kept in prod deps so `migrate deploy` runs offline in the image
    // ...next, react, react-dom, socket.io, @socket.io/redis-adapter, ioredis, @prisma/client, etc.
  },
  "devDependencies": {
    "esbuild": "^0.25", "tsx": "^4"                   // build-time + dev only
  }
}
```

> `esbuild ... --packages=external` bundles only first-party code (it resolves the `@/` alias from
> `tsconfig.json` `paths` and inlines `lib/websocket/server.ts`, `lib/cache/redis.ts`, etc.) while
> leaving `next`, `socket.io`, `ioredis`, and `@prisma/client` to load from `node_modules` at
> runtime. ESM output is required because the server uses top-level `await app.prepare()`.
> Have the server bind `process.env.PORT ?? 3000` so the container's `PORT` is honoured.

```dockerfile
# syntax=docker/dockerfile:1
# PRGraph uses a CUSTOM server (Next request handler + Socket.IO in one process), so we do NOT use
# Next's `output:'standalone'`. We build .next normally, compile server/websocket.ts to a single ESM
# file, and ship a production node_modules.
# Next.js 16 needs Node 20.9+, but Node 20 is EOL (Apr 2026) → Node 24 LTS.
# Turbopack is the default bundler in 16; `next build` needs no --turbopack flag.

# 1) deps — full install (dev + prod), used only to build
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2) builder — generate Prisma client, build Next, bundle the custom server
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build            # next build (Turbopack) → .next
RUN npm run build:server     # esbuild server/websocket.ts → dist/server.mjs

# 3) prod-deps — clean production-only node_modules (no dev tooling in the runtime image)
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 4) runner — minimal runtime image
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# production deps, then overlay the Prisma client generated in the builder
COPY --from=prod-deps /app/node_modules                ./node_modules
COPY --from=builder   /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=builder   /app/node_modules/@prisma/client ./node_modules/@prisma/client

# app artifacts: the real .next build (NOT .next/standalone), assets, prisma, compiled server, config
COPY --from=builder /app/.next         ./.next
COPY --from=builder /app/public        ./public
COPY --from=builder /app/prisma        ./prisma
COPY --from=builder /app/dist          ./dist
COPY --from=builder /app/next.config.* ./
COPY --from=builder /app/package.json  ./package.json
COPY scripts/start.sh ./start.sh
RUN chmod +x start.sh && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["./start.sh"]
```

```bash
# scripts/start.sh
#!/bin/sh
set -e
echo "Running database migrations..."
node_modules/.bin/prisma migrate deploy     # prisma CLI is a prod dependency (offline, no npx fetch)
echo "Starting PRGraph custom server (Next + Socket.IO)..."
exec node dist/server.mjs                    # the compiled custom server — NOT .next/standalone/server.js
```

**Why this is the right call (and the interview soundbite):** *"PRGraph hosts Next and Socket.IO in
one custom server, so I can't use Next's `standalone` output — it ships its own server that drops the
WebSocket layer. I keep the single-image deployment but build it honestly: `next build` for the app,
an esbuild bundle of the custom server to one ESM file, and a separate production-only `npm ci
--omit=dev` stage so the runtime image carries no dev toolchain. Prisma's CLI stays a prod dependency
so `migrate deploy` runs offline at boot, and the container runs as a non-root user."*

**Trade-off / alternative.** This image is larger than a standalone one because it carries a full
production `node_modules` instead of Next's traced subset — the unavoidable cost of a custom server.
If image size becomes a concern you can keep `output: 'standalone'` *and* force the custom server plus
its extra deps into the trace via `outputFileTracingIncludes` in `next.config.ts`, then run the
custom entry instead of the emitted `server.js`. It produces a smaller image but is finicky to keep
correct as dependencies change, so it isn't the default here.

### 9.2 Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/prgraph
      - REDIS_URL=redis://redis:6379
      - GITHUB_APP_ID=${GITHUB_APP_ID}
      - GITHUB_APP_PRIVATE_KEY=${GITHUB_APP_PRIVATE_KEY}
      - GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
      - GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - SLACK_CLIENT_ID=${SLACK_CLIENT_ID}
      - SLACK_CLIENT_SECRET=${SLACK_CLIENT_SECRET}
      - SLACK_SIGNING_SECRET=${SLACK_SIGNING_SECRET}
      - NEXTAUTH_URL=http://localhost:3000
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=prgraph
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # --- Monitoring ---
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources

volumes:
  postgres_data:
  redis_data:
  grafana_data:
```

### 9.3 Kubernetes (Interview Discussion)

```
"For production K8s deployment of a multi-tenant SaaS version:

STATELESS:
- app: Deployment with 2-3 replicas, HPA on CPU (70%) and custom metric
  (webhook queue depth). Each replica runs both Next.js SSR and the
  Socket.IO server. Sticky sessions via Ingress annotation for WebSocket.

STATEFUL (managed services):
- PostgreSQL: AWS RDS or Neon (serverless Postgres)
- Redis: AWS ElastiCache or Upstash (serverless Redis)

WEBSOCKET SCALING CHALLENGE:
WebSocket connections are sticky to one pod. If a webhook arrives at Pod A
but the client is connected to Pod B, we need cross-pod communication.
Solution: Redis Pub/Sub as a message bus between Socket.IO instances.
Socket.IO has a built-in Redis adapter (@socket.io/redis-adapter) that
handles this transparently.

INGRESS:
- Nginx Ingress with WebSocket upgrade support
- TLS via cert-manager + Let's Encrypt
- /api/webhooks/* path gets higher timeout (30s) for webhook processing

SECRETS:
- GitHub App private key, Slack tokens → K8s Secrets
- External Secrets Operator for AWS Secrets Manager"
```

---

## 10. CI/CD Pipeline — GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: prgraph_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports: [5432:5432]
        options: --health-cmd pg_isready --health-interval 10s
      redis:
        image: redis:7-alpine
        ports: [6379:6379]
        options: --health-cmd "redis-cli ping" --health-interval 10s

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npx tsc --noEmit

      - name: Unit tests (graph algorithms)
        run: npm run test:unit

      - name: Integration tests
        run: npm run test:integration
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/prgraph_test
          REDIS_URL: redis://localhost:6379

      - name: Build
        run: npm run build
```

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

env:
  IMAGE: ${{ secrets.DOCKER_USERNAME }}/prgraph

jobs:
  deploy:
    runs-on: ubuntu-latest
    needs: []  # Runs after CI passes (branch protection rule)
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Build & push
        run: |
          docker build -t $IMAGE:${{ github.sha }} -t $IMAGE:latest .
          docker push $IMAGE --all-tags

      - name: Deploy to Railway
        uses: railwayapp/cli-action@v1
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
          command: up

      # OR deploy to EC2
      # - name: Deploy to EC2
      #   uses: appleboy/ssh-action@master
      #   with:
      #     host: ${{ secrets.EC2_HOST }}
      #     username: ubuntu
      #     key: ${{ secrets.EC2_SSH_KEY }}
      #     script: |
      #       cd /opt/prgraph
      #       docker compose pull
      #       docker compose up -d --remove-orphans
```

---

## 11. Monitoring & Observability

### Key Metrics — Grafana Dashboard (4 Panels)

**Panel 1: GitHub API Quota**
- Metric: `github_api_remaining_calls`
- Alert: if < 500 remaining (out of 5000/hour)
- Why: Running out of API calls = blind — can't fetch PR data

**Panel 2: Graph Computation Time**
- Metric: `graph_compute_duration_ms_bucket`
- Target: P50 < 500ms, P95 < 2s
- Why: Slow computation = delayed WebSocket updates

**Panel 3: Webhook Processing Latency**
- Metric: `webhook_process_duration_ms_bucket`
- Target: P95 < 5s (must respond 200 within 10s per GitHub)
- Shows: Time from webhook receipt to graph update pushed

**Panel 4: Active Installations**
- Metric: `prgraph_installations_total`
- Shows: Growth over time — proof of real adoption

### The "Scaling Decision" to Document

> **Scaling Decision: In-Memory Graph Computation over Database-Side Graph Queries**
>
> I had two options for computing the dependency graph:
>
> **Option A — Database-side:** Use PostgreSQL recursive CTEs or window functions to compute transitive dependencies directly in SQL. Pros: no data transfer. Cons: topological sort and cycle detection in SQL is complex, hard to debug, and doesn't leverage React Flow's JavaScript-native data model.
>
> **Option B — Application-side:** Fetch all PRs + files into Node.js memory, build the graph with TypeScript, run Kahn's algorithm and DFS cycle detection, then store the computed result. Pros: algorithms are clean, testable, and debuggable in TypeScript. Cons: data transfer from DB to app.
>
> **Decision:** Option B. A repo with 100 open PRs and 20 files each = ~2000 file records. This is ~200KB of data — trivial to transfer. The graph algorithms (topological sort, cycle detection) are clean 50-line TypeScript functions with 100% unit test coverage. Implementing the same logic in recursive SQL CTEs would be fragile, hard to test, and impossible for contributors to understand.
>
> **When I'd revisit:** If PRGraph became a multi-tenant SaaS with 10,000 repos computing graphs simultaneously, I'd add a dedicated graph computation worker service (possibly in Rust for performance) that reads from a shared Redis cache rather than hitting PostgreSQL per request.

---

## 12. README Blueprint

```markdown
# PRGraph — PR Dependency Visualiser 📊

> See which PRs are blocking your team — before you merge the wrong one.

[![CI](https://github.com/you/prgraph/actions/workflows/ci.yml/badge.svg)]()
[![Deploy](https://github.com/you/prgraph/actions/workflows/deploy.yml/badge.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)]()
[![GitHub stars](https://img.shields.io/github/stars/you/prgraph)]()

[LIVE DEMO](https://prgraph.dev) | [Install on GitHub](https://github.com/apps/prgraph) | [Video Demo](https://youtube.com/...)

![Graph View](docs/screenshot-graph.png)
![Slack Notification](docs/screenshot-slack.png)

## The Problem
Your team has 30 open PRs. You merge one — and 3 others now have conflicts.
Nobody knew PR #42 was blocking PRs #57, #63, and #71 because they touch
the same files. PRGraph makes these invisible dependencies visible.

## How It Works
1. Install the GitHub App on your repo
2. PRGraph fetches all open PRs and their changed files
3. Builds a dependency graph: PR A → blocks → PR B (they touch the same files)
4. Shows an interactive diagram: green (safe to merge), yellow (has deps), red (blocked)
5. When you merge a PR, the graph updates in real-time via WebSocket
6. Slack notifies your team: "PR #42 merged — PR #57 is now safe to merge!"

## Tech Stack
Next.js 16 (React 19.2) · TypeScript · React Flow · PostgreSQL 16 · Redis 7 ·
Socket.IO · GitHub API · Slack Bolt · Docker · GitHub Actions
**+ provider-agnostic LLM adapter (GPT-5.4-mini / Claude / local) for semantic conflict analysis**

## Architecture
[Include HLD diagram from Section 4]

### Key Decisions
1. PostgreSQL over Neo4j — graph is < 500 nodes, recomputed on every webhook.
   Junction table + in-memory algorithms beat a graph DB for this scale.
2. Redis Streams over Kafka — ~100 webhooks/hour doesn't justify 3 Kafka brokers.
3. In-memory graph computation — 50-line TypeScript algorithms > recursive SQL CTEs.
   Clean, testable, contributor-friendly.
4. Next.js full-stack — one repo, one Docker image, one deploy. Minimal contributor friction.
5. Provider-agnostic LLM adapter, not a hardcoded vendor — default GPT-5.4-mini chosen
   on eval evidence (F1 vs cost), swappable to Claude/Gemini/local in one config line.
   AI is a strict enhancement: a heuristic fallback keeps the graph working when it's off.

## Quick Start
    git clone https://github.com/you/prgraph.git
    cd prgraph
    cp .env.example .env    # Add GitHub App credentials
    docker compose up -d
    open http://localhost:3000

## Self-Hosting
See [SELF_HOSTING.md](docs/SELF_HOSTING.md) for production deployment guide.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md). We welcome PRs!
Good first issues are labeled `good-first-issue`.

## License
MIT — use it, fork it, make it better.
```

---

## 13. Interview Prep — Top Questions & Answers

### System Design Questions

**Q1: "Walk me through the architecture."**

> "It's a Next.js full-stack application — frontend and API routes in one deployment. When a user installs the GitHub App, we fetch all open PRs and their changed files. The graph engine builds an inverted index mapping each file to the PRs that touch it, then constructs a directed acyclic graph where edges mean 'PR A blocks PR B because they modify the same files.' I run Kahn's algorithm for topological sort to determine merge order, and DFS for cycle detection to find deadlocks. The graph renders as an interactive React Flow diagram. GitHub webhooks notify us of PR events in real-time — we queue these in Redis Streams, recompute the graph, push updates to all connected clients via Socket.IO, and notify Slack. PostgreSQL persists the graph, and Redis caches GitHub API responses to stay within rate limits."

**Q2: "Why PostgreSQL instead of Neo4j for a graph problem?"**

> "Our graph is 10-50 nodes per repo — trivially small. It's recomputed from scratch on every webhook event and the computation happens in-memory with TypeScript. PostgreSQL just persists the result. Neo4j's value is multi-hop traversals across millions of nodes — social networks, recommendation engines. For 50 nodes, a PostgreSQL junction table with 2 JOINs returns 'what blocks PR #42?' in under 1 millisecond. Adding Neo4j would double the Docker Compose setup and contributor friction for zero performance benefit."

**Q3: "Explain the graph algorithm."**

> "Three steps. First, I build an inverted index: for each changed file, list all PRs that touch it. If a file is touched by 2+ PRs, those PRs have a dependency. Second, I create edges: the earlier PR (by creation date) has priority — it 'blocks' the later one. Third, I classify each node: SAFE has zero incoming edges and can be merged now; BLOCKED has incoming edges and must wait; DEADLOCKED is part of a cycle and needs manual resolution. Merge order comes from Kahn's topological sort — level 0 nodes merge first, then level 1 (which were blocked only by level 0), and so on."

**Q4: "How do you handle GitHub API rate limits?"**

> "GitHub allows 5,000 requests per hour per installation. Fetching 50 PRs + files = 51 calls per sync. I use a cache-first approach with Redis: PR lists cached for 2 minutes, file lists for 5 minutes. On webhook events, I only re-fetch the changed PR's files — everything else comes from cache. I track remaining quota in Redis from GitHub's X-RateLimit-Remaining header. If quota drops below 500, I extend cache TTLs and defer non-critical syncs. I also use GitHub ETags for conditional requests — if data hasn't changed, GitHub returns 304 and it doesn't count against the quota."

**Q5: "How would you scale this to 10,000 repositories?"**

> "Three changes. First, the webhook queue: Redis Streams handles ~100 events/hour per repo fine, but 10,000 repos × 10 events/hour = 100K events/hour. I'd migrate to Kafka with topic partitioning by repo ID — each partition processes independently. Second, Socket.IO: I'd use the Redis adapter (@socket.io/redis-adapter) so multiple Next.js replicas share WebSocket state. Third, graph computation becomes the bottleneck — I'd add a pool of dedicated graph worker processes reading from the Kafka topic, with each worker handling a partition. Database-wise, PostgreSQL handles this fine — read replicas for dashboard queries, primary for writes."

**Q6: "Why Next.js full-stack instead of Spring Boot?"**

> "Deliberate trade-off. This is an open-source developer tool — contributors expect TypeScript, one-command setup, and a single repo. Spring Boot + React would mean two projects, two Docker images, CORS configuration, and more setup friction. The backend logic is I/O-heavy (GitHub API calls, Redis operations) and compute-light (graph algorithm on < 500 nodes) — perfect for Node.js. If this were a high-throughput enterprise service processing millions of webhooks, I'd choose Spring Boot with virtual threads for CPU-bound concurrency."

**Q7: "Explain the WebSocket architecture."**

> "Socket.IO manages real-time graph updates. When a client opens a repo's graph view, it joins a Socket.IO room named `repo:{repoId}`. When a webhook triggers graph recomputation, the server emits the updated graph to that room — all connected clients see the update simultaneously. The graph diff includes which nodes changed status (e.g., PR #57 went from BLOCKED to SAFE), so the frontend can animate the transition. For horizontal scaling, Socket.IO's Redis adapter uses Redis Pub/Sub as a message bus between server instances."

### Algorithm Questions

**Q8: "What's the time complexity of your graph algorithm?"**

> "Let P = number of open PRs, F = average files per PR. Building the inverted index is O(P × F). Computing pairwise overlaps is O(F × K²) where K is the max number of PRs touching a single file — typically 2-3, so effectively O(P × F). Topological sort is O(V + E) where V = P (nodes) and E = number of edges. Cycle detection is O(V + E). Total: O(P × F + P + E), which for 50 PRs with 20 files each is < 1ms. The bottleneck is always the GitHub API calls, not the algorithm."

**Q9: "How do you handle cycles (deadlocks)?"**

> "Cycles mean mutual blocking — PR A touches file X and PR B also touches file X, but neither can merge first without conflicting. I detect cycles using DFS with a 'visiting' state (grey nodes in the standard 3-color algorithm). Nodes in cycles are marked DEADLOCKED (red) and highlighted in the graph. The side panel suggests resolution: 'These PRs have circular dependencies on files X and Y. Consider merging PR #42 first (fewer changes) and rebasing #57 after.' This is a manual decision the team must make — no algorithm can resolve true mutual conflicts."

### DevOps Questions

**Q10: "Why a single Docker image instead of separate frontend/backend?"**

> "Next.js combines frontend SSR and API routes in one process. One Docker image means one build, one push, one deployment. For an open-source tool, this is critical — `docker compose up` starts the entire app. Separate images would mean contributors need to understand inter-service networking, CORS, and health check ordering. The trade-off is that horizontal scaling scales everything together — but for a tool that serves mostly WebSocket connections and occasional API calls, that's fine. If the API became a bottleneck, I'd extract it to a separate service."

**Q11: "Describe a scaling decision you made."**

> "I chose to compute the dependency graph in-memory (Node.js) rather than in the database (SQL CTEs). With 50 PRs and 20 files each, the entire dataset is ~200KB — trivial to transfer. The graph algorithms are 50-line TypeScript functions with 100% test coverage. Implementing topological sort in recursive SQL would be fragile, hard to debug, and impossible for open-source contributors to understand. The trade-off is a brief data transfer from DB to app, which at our scale adds < 5ms."

**Q12: "How do you handle webhook reliability?"**

> "Three mechanisms. First, signature validation: I verify the HMAC-SHA256 of every webhook payload using the shared secret — rejects spoofed requests. Second, idempotency: each webhook has a unique delivery ID. I store `webhook:dedup:{deliveryId}` in Redis with a 5-minute TTL. If the same delivery arrives twice, the second is silently skipped. Third, Redis Streams with acknowledgment: if graph computation fails mid-way, the message stays in the pending queue and gets retried. This handles transient failures (GitHub API timeout during recomputation) without losing events."

### AI / MLOps Questions (Phase 2 feature)

**Q13: "Why add an LLM at all — isn't file overlap enough?"**

> "File overlap is a cheap, deterministic first pass, but it over-reports. Two PRs both touching `auth.ts` get flagged as blocking even if one edits the login function and the other edits an unrelated helper 200 lines away — no real conflict. The LLM reads the actual diff hunks of both PRs and decides whether they *semantically* collide. It turns 'these touch the same file' into 'these both rewrite `validateToken()`, so merging both will conflict — merge #42 first, it's smaller.' The deterministic engine stays as the fallback, so the product still works with the AI turned off."

**Q14: "Did you use GPT-5? Why that model?"**

> "I built a provider-agnostic adapter rather than hardcoding a vendor — that was the actual engineering decision. 'GPT-5' the original August-2025 model is two generations old now; OpenAI's current flagship is GPT-5.4, which folded in Codex-level coding. My default is a small, cheap, coding-capable model — GPT-5.4-mini — because conflict analysis is a short, structured task that doesn't need a frontier reasoning tier. The key thing is I can justify the choice empirically: I have an eval set of ~40 hand-labeled PR pairs and an eval harness in CI. I ran the same prompt against two providers and picked the one with the better precision/recall-to-cost ratio. The adapter means switching providers is a one-line config change, not a rewrite."

**Q15: "How do you keep LLM cost and latency under control?"**

> "Four levers. Caching: I key every verdict on `sha256(promptVersion + diffA + diffB)` in Redis — the same PR pair never costs twice, and across a busy repo the cache hit ratio is high because most pairs don't change between webhooks. Model tiering: a cheap mini model by default, escalating to a bigger one only on UNCERTAIN verdicts. Budget circuit breaker: I track `llm_cost_usd_total` in Prometheus; past a daily cap the analyzer trips open and the graph silently falls back to the heuristic. And batching: I only analyze pairs the deterministic engine already flagged as overlapping — typically a handful per repo, not the full N²."

**Q16: "How do you stop the LLM from regressing when you change a prompt?"**

> "Prompts are versioned files, not inline strings, and there's an eval harness in CI. Every PR that touches a prompt runs the analyzer against the labeled eval set and computes F1. If F1 drops below the threshold, CI fails — same as a unit test regression. That's the MLOps discipline: a prompt change is a code change and gets gated like one."

### Resilience & Availability Questions

**Q17: "What happens when GitHub's API is down?"**

> "Graceful degradation, not failure. Every GitHub call goes through a circuit breaker with a cache fallback — if the breaker is open, we serve the last-known graph from Redis with a 'data may be stale' banner. Reads stay available; only freshness degrades. Webhook events that can't be processed sit in the Redis Stream pending list and get retried with exponential backoff once the breaker half-opens. We choose availability over strict freshness here because a slightly stale dependency graph is still useful, whereas a blank error page is not."

**Q18: "Is your graph strongly or eventually consistent?"**

> "Eventually consistent by design, and that's the right call. The source of truth is GitHub, which we observe through webhooks (push) and periodic sync (pull). There's an unavoidable lag between a merge happening on GitHub and our graph reflecting it. We make that lag small and bounded — webhook processing P95 under 5 seconds — and we make it visible with a 'last synced' timestamp. We get at-least-once delivery from GitHub plus idempotent processing on our side, so we never lose an event and never double-apply one. Strong consistency would mean polling GitHub synchronously on every read, which is slower, blows the rate limit, and buys nothing for a human-in-the-loop tool."

---

## 14. AI Semantic Conflict Analysis — The Differentiator

### 14.1 The Problem with File-Level Overlap (and why this feature exists)

Rev 1's engine says: *"PR #42 and PR #57 both touch `src/auth.ts` → #42 blocks #57."* That is correct but **coarse**. Real engineering teams hit two false-positive cases constantly:

- **Co-located, not conflicting:** #42 edits `validateToken()` at line 20; #57 adds a new `import` at the top. Same file, zero real conflict. Git would merge both cleanly.
- **Different blocks:** #42 edits the `LoginForm` component; #57 edits the `Footer` in the same 800-line file. No overlap in the actual hunks.

Over-reporting trains users to ignore the tool ("it always says everything is blocked"). The AI pass converts a **file-level heuristic** into a **hunk-level semantic verdict**:

| Verdict | Meaning | Graph effect |
|---|---|---|
| `TRUE_CONFLICT` | Both PRs modify overlapping lines / the same function | Hard blocking edge (red) |
| `CO_LOCATED` | Same file, disjoint hunks, no semantic interaction | Soft edge (grey, dashed) — "merge in parallel, but rebase" |
| `UNCERTAIN` | LLM not confident (large diffs, generated files) | Keep the heuristic blocking edge + flag for human review |

### 14.2 Where It Sits in the Pipeline

The AI pass is a **refinement stage on edges the deterministic engine already produced** — never a replacement. This bounds cost (you only analyze the handful of overlapping pairs, not all N²) and guarantees a working product when AI is off.

```
Deterministic engine (Rev 1)
   produces candidate edges (file overlap)
        │
        ▼
   For each candidate edge (PR_A, PR_B):
        │
        ├─ cache hit? ──► reuse cached verdict (Redis)
        │
        └─ cache miss ─► LLMAdapter.analyze(diffA, diffB)
                              │
                              ├─ TRUE_CONFLICT / CO_LOCATED / UNCERTAIN
                              ├─ one-paragraph explanation
                              └─ suggested resolution order
        │
        ▼
   Edges re-classified + explanations attached
        │
        ▼
   Topological sort runs on TRUE_CONFLICT edges only
   (CO_LOCATED edges no longer block → more PRs become SAFE)
```

**Key insight for interviews:** the AI doesn't just annotate — it *changes the merge order*, because demoting `CO_LOCATED` edges from blocking to non-blocking unblocks PRs that the file-level engine wrongly held back. That is a visible, demonstrable improvement.

### 14.3 The Analyzer (provider-agnostic)

```typescript
// lib/ai/conflictAnalyzer.ts
import { z } from 'zod';
import { LLMAdapter } from './adapters/types';
import { getPrompt } from './prompts/registry';
import { redis } from '../cache/redis';
import crypto from 'crypto';

export const VerdictSchema = z.object({
  verdict: z.enum(['TRUE_CONFLICT', 'CO_LOCATED', 'UNCERTAIN']),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(400),
  suggestedOrder: z.array(z.number()).optional(), // PR numbers, earliest-first
});
export type Verdict = z.infer<typeof VerdictSchema>;

const PROMPT_VERSION = 'conflict.v3';

export async function analyzeConflict(
  adapter: LLMAdapter,
  prA: { number: number; diff: string },
  prB: { number: number; diff: string },
): Promise<Verdict> {
  // 1. Cache key is content-addressed: same diffs + same prompt = same answer
  const key = `ai:conflict:${PROMPT_VERSION}:` +
    crypto.createHash('sha256').update(prA.diff + '\u0000' + prB.diff).digest('hex');

  const cached = await redis.get(key);
  if (cached) return VerdictSchema.parse(JSON.parse(cached));

  // 2. Build a versioned prompt, demand strict JSON
  const prompt = getPrompt(PROMPT_VERSION, { prA, prB });

  // 3. Call through the adapter (provider-agnostic) with timeout + retry handled inside
  const raw = await adapter.completeJSON(prompt);

  // 4. Validate the model's output against the schema — never trust raw LLM text
  const verdict = VerdictSchema.parse(raw);

  // 5. Cache for 24h (diffs rarely change between webhooks within a PR's life)
  await redis.setex(key, 86_400, JSON.stringify(verdict));
  return verdict;
}
```

### 14.4 Heuristic Fallback (the product never breaks)

```typescript
// If AI is disabled, over budget, or the adapter throws after retries,
// fall back to the deterministic verdict so the graph still renders.
export async function analyzeOrFallback(...args): Promise<Verdict> {
  if (!aiEnabled() || budgetExceeded()) return heuristicVerdict(args); // TRUE_CONFLICT by default
  try {
    return await analyzeConflict(...args);
  } catch (err) {
    metrics.increment('ai.fallback.error');
    return heuristicVerdict(args); // degrade to Rev 1 behaviour, never to an error
  }
}
```

This is the single most important architectural sentence in the whole AI design: **AI failure degrades the product to "Rev 1 behaviour," never to "broken."**

---

## 15. MLOps Wrapper + GPT-5 / Model Choice Analysis

This section is what makes the project credible to an **AI Engineer** panel, not just a full-stack one. A fresher who "called the OpenAI API" is common; a fresher who wrapped it in a provider-agnostic adapter, versioned prompts, gated CI on an eval set, and tracked cost in Prometheus is rare.

### 15.1 Provider-Agnostic LLM Adapter (the core abstraction)

```typescript
// lib/ai/adapters/types.ts
export interface LLMAdapter {
  readonly name: string;            // "openai:gpt-5.4-mini", "anthropic:claude", "ollama:qwen-coder"
  completeJSON(prompt: Prompt): Promise<unknown>;  // returns parsed JSON, throws on failure
  estimateCostUsd(promptTokens: number, completionTokens: number): number;
}
```

Concrete adapters (`OpenAIAdapter`, `AnthropicAdapter`, `OllamaAdapter`) each implement timeout, retry-with-backoff, and token accounting internally. The application code never imports a vendor SDK directly — it depends only on `LLMAdapter`. Switching the default model is a single environment variable: `LLM_PROVIDER=openai:gpt-5.4-mini`.

**Why this is the right pattern (interview answer):**
> "I never hardcode a model. Models change every few months — when I started, GPT-5 was current; by the time I shipped, GPT-5.4 had superseded it and folded in Codex-level coding. An adapter means a new model is a config change, not a refactor. It also let me A/B two providers against the same eval set and pick on evidence, not vibes."

### 15.2 The Five MLOps Components

| Component | What it does | Why a fresher rarely has this |
|---|---|---|
| **Provider-agnostic adapter** | One interface, swappable backends | Most people import `openai` directly and couple to it |
| **Prompt registry (versioned)** | Prompts are files (`conflict.v3.ts`), not inline strings; the version is part of the cache key | Treats prompts as code that can regress |
| **Eval harness gating CI** | ~40 hand-labeled PR pairs; computes precision/recall/F1; CI fails on regression | Brings test discipline to a non-deterministic component |
| **Response cache (content-addressed)** | `sha256(promptVersion+diffA+diffB)` → verdict, 24h TTL in Redis | Turns an expensive call into a near-free one; huge cost lever |
| **Cost & latency telemetry + budget breaker** | Prometheus counters; trips to fallback past a daily USD cap | Shows you think about $ and SLOs, not just "it works" |

### 15.3 GPT-5 / Model Choice — The Honest, Current Answer

**The literal question "should it use GPT-5?" has a dated premise.** As of mid-2026:

- The original **GPT-5** (released Aug 7, 2025) is two generations behind. OpenAI's current flagship is **GPT-5.4** (released March 5, 2026), the first mainline model to absorb GPT-5.3-Codex's frontier coding capabilities, so a separate code-specialist model is no longer needed.
- GPT-5.4 ships as a family — **Standard, Thinking, Pro, Mini, and Nano** — so "GPT-5.4" is a tier choice, not one model.
- A frontier reasoning tier (GPT-5.4 Pro at premium pricing, with an input surcharge above ~272K context) is **overkill** for this task. Conflict analysis is a short, well-structured classification over two diffs — exactly what a small, cheap, coding-capable model handles well.

**Decision matrix for THIS task (short structured diff classification):**

| Option | Fit for the task | Cost posture | Verdict |
|---|---|---|---|
| **GPT-5.4-mini (default)** | Strong: coding-aware, fast, structured JSON, low latency | ~$0.75/M in, ~$4.50/M out — cheap per analysis | **Default.** Best cost/quality for a short classification task |
| GPT-5.4 (Standard) | Slightly better on gnarly diffs | ~3× mini | Escalation target for `UNCERTAIN` verdicts only |
| GPT-5.4 Pro / Thinking | Overkill; the long-context surcharge hurts on big diffs | Premium | Reject — wrong tool for a bounded classification |
| Claude (Anthropic) | Strong code reasoning; great fallback provider | Comparable tier | **Keep as the swappable second provider** for your eval A/B |
| Gemini 3.x | Competitive; good multimodal (irrelevant here) | Comparable | Optional third adapter |
| Local (Ollama, e.g. a coder model) | Privacy/self-host story; no per-call cost | Free but slower, needs a GPU host | **Worth one adapter** — lets self-hosters run with zero API cost; great open-source story |

**The defensible interview position:**
> "I default to GPT-5.4-mini because conflict analysis is a short structured task and the mini tier gives me coding-aware quality at a fraction of the flagship cost — and I can prove the quality with my eval set. The frontier tiers are overkill and the long-context surcharge would bite on large diffs. But the real decision is the adapter: I'm not betting the project on one vendor. I keep a second cloud provider and a local model behind the same interface, and I A/B them on the same eval. That's how I'd defend any model choice — with numbers, not loyalty."

**Note on the *other* reading — "is GPT-5 better for *building* the project?"** That's a coding-assistant choice (which AI helps you write the code), not an architecture decision. Both GPT-5.4 and Claude are frontier coding models; pick whichever you're faster with. It doesn't change a single line of the design above.

### 15.4 Eval Harness (the CI gate)

```typescript
// evals/conflict.eval.ts  — runs in CI on any PR touching prompts or the analyzer
import labeled from './fixtures/labeled-pairs.json'; // [{prA, prB, label}]

const TARGET_F1 = 0.80;

(async () => {
  let tp = 0, fp = 0, fn = 0;
  for (const ex of labeled) {
    const { verdict } = await analyzeConflict(adapter, ex.prA, ex.prB);
    const predictedConflict = verdict === 'TRUE_CONFLICT';
    const actualConflict = ex.label === 'TRUE_CONFLICT';
    if (predictedConflict && actualConflict) tp++;
    else if (predictedConflict && !actualConflict) fp++;
    else if (!predictedConflict && actualConflict) fn++;
  }
  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  const f1 = 2 * precision * recall / (precision + recall || 1);
  console.log(`precision=${precision.toFixed(2)} recall=${recall.toFixed(2)} f1=${f1.toFixed(2)}`);
  if (f1 < TARGET_F1) { console.error(`F1 ${f1} below ${TARGET_F1}`); process.exit(1); } // fail CI
})();
```

This is the line that wins AI interviews: *"My prompt has a test suite. A prompt change that regresses quality fails CI exactly like a broken unit test."*

---

## 16. Resilience Patterns

Rev 1 had a circuit breaker only. Here is the full set, with the **specific failure each one defends against** in PRGraph.

| Pattern | PRGraph application | Failure it prevents |
|---|---|---|
| **Timeout** | Every GitHub/Slack/LLM call has an explicit deadline (GitHub 10s, LLM 15s) | A hung upstream call holding a worker forever |
| **Retry + exponential backoff + jitter** | Transient GitHub 5xx / rate-limit 403 → retry 3× with `base * 2^n + rand(0..base)` | Thundering-herd retries; transient blips killing a sync |
| **Circuit breaker** | Per-upstream (GitHub, Slack, each LLM provider) via `opossum` | Hammering a downed dependency; cascading slowness |
| **Bulkhead** | Separate Redis Stream consumer groups + worker concurrency caps for *webhook processing* vs *AI analysis* | A slow LLM batch starving real-time graph updates |
| **Dead-letter queue** | After max retries, a webhook event is `XADD`ed to `webhook-events-dlq` with the error | Silent event loss; gives you a replay path + an alert |
| **Idempotency** | `webhook:dedup:{deliveryId}` (SET NX) + content-addressed AI cache | Double-processing duplicate GitHub deliveries |
| **Graceful degradation** | Stale-but-valid cached graph served when GitHub down; heuristic verdict when LLM down | A blank error page instead of a slightly-stale-but-useful graph |
| **Rate-limit governor** | Track `X-RateLimit-Remaining` in Redis; extend cache TTLs + defer non-critical syncs below 500 | Getting hard-blocked by GitHub and going fully blind |
| **Backpressure** | If webhook queue depth exceeds a threshold, shed AI analysis first (it's optional), keep core graph updates | Queue unbounded growth under a burst of merges |

### Retry with backoff + jitter (reference)

```typescript
async function withRetry<T>(fn: () => Promise<T>, max = 3, base = 300): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt >= max || !isTransient(err)) throw err;
      const delay = base * 2 ** attempt + Math.random() * base; // full jitter
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

**Resilience layering (interview soundbite):** *"Timeout bounds a single call, retry handles a blip, the circuit breaker handles a sustained outage, the bulkhead stops one slow path from sinking another, and the DLQ guarantees I can replay anything that still failed. Each layer catches what the one below it can't."*

---

## 17. Availability & Consistency Patterns

### 17.1 CAP Positioning

PRGraph is a **read-heavy, human-in-the-loop tool over data it does not own** (GitHub is the source of truth). It deliberately chooses **AP — availability + partition tolerance over strong consistency.**

> A dependency graph that is 5 seconds stale is still useful; a blank error page is not. So when we can't reach GitHub, we serve the last-known graph and mark it stale rather than failing the read.

### 17.2 The Consistency Model — Eventual, Bounded, Visible

| Property | How PRGraph achieves it |
|---|---|
| **Eventual consistency** | GitHub state → webhook/sync → recompute → cache → clients. Convergence, not instantaneous agreement. |
| **Bounded staleness** | Webhook processing P95 < 5s; a periodic reconciliation sync (every N min) catches any webhook GitHub dropped. |
| **Visible staleness** | Every graph view shows a `last synced 12s ago` timestamp; a "stale" banner appears if the GitHub breaker is open. |
| **At-least-once delivery** | GitHub may redeliver webhooks; Redis Streams may redeliver on consumer crash. We accept duplicates... |
| **...made safe by idempotency** | ...and dedupe on `deliveryId` + content-addressed AI cache, so at-least-once behaves like exactly-once at the effect level. |
| **Read-your-writes (per repo)** | After a manual sync, the triggering client gets the fresh graph pushed over its own WebSocket before the banner clears. |

### 17.3 Availability Patterns

- **Cache-as-availability-buffer:** Redis holds the last-good graph; reads survive a total GitHub outage (degraded freshness, full availability).
- **Stale-while-revalidate:** serve the cached graph instantly, kick off a background refresh, push the update when it lands. Latency stays low even on cache-miss-adjacent paths.
- **Stateless app tier:** the Next.js/Socket.IO process holds no durable state → any replica can serve any request; losing a replica loses nothing (state lives in PostgreSQL + Redis).
- **WebSocket fan-out via Redis Pub/Sub adapter:** when scaled to multiple replicas, `@socket.io/redis-adapter` means a webhook landing on Pod A still reaches a client connected to Pod B — no single pod is a SPOF for a repo's viewers.
- **Health checks + readiness gates:** `/api/health` checks PostgreSQL + Redis connectivity; K8s readiness probe pulls an unhealthy pod out of rotation before it serves errors.

### 17.4 Consistency Edge Cases (be ready for these)

- **Out-of-order webhooks:** GitHub does not guarantee ordering. Mitigation: we recompute the *whole* graph from current GitHub state on each event rather than applying deltas, so order doesn't matter — the recompute is idempotent w.r.t. the latest state.
- **Webhook lost entirely:** the periodic reconciliation sync is the safety net; bounded staleness is restored at the next sync interval even if a webhook never arrives.
- **Concurrent recomputes for one repo:** a Redis lock (`SET NX` on `graph:lock:{repoId}`) ensures one in-flight recompute per repo; a queued event coalesces rather than racing.

---

## 18. Mitigation Strategies (Failure-Mode Table)

A single consolidated table an interviewer can walk top-to-bottom. Each row: what breaks → who feels it → how we contain it.

| # | Failure mode | Blast radius | Detection | Mitigation |
|---|---|---|---|---|
| 1 | GitHub API down / 5xx | All syncs for all repos | Circuit-breaker open metric; error rate | Serve stale cached graph + "stale" banner; retry w/ backoff; reconcile on recovery |
| 2 | GitHub rate limit exhausted | Repos syncing on that installation | `X-RateLimit-Remaining` < 500 metric | Extend cache TTLs; defer non-critical syncs; ETag conditional requests (304s don't count) |
| 3 | Webhook signature invalid | Single request | HMAC mismatch | Reject with 401; log + metric (possible spoofing attempt) |
| 4 | Duplicate webhook delivery | Single repo | `deliveryId` already in Redis | Idempotent skip (SET NX) |
| 5 | Graph recompute throws | One repo's graph | Worker exception; DLQ depth | Event → DLQ with error; alert; last-good graph stays served; manual/auto replay |
| 6 | LLM provider down / slow | AI annotations only | Adapter timeout; breaker open | Heuristic fallback (Rev 1 behaviour); core graph unaffected |
| 7 | LLM cost spike | Budget | `llm_cost_usd_total` > daily cap | Budget breaker trips → AI off → heuristic; alert |
| 8 | Bad prompt change regresses quality | Future analyses | Eval F1 < threshold | CI fails the PR before merge (regression gate) |
| 9 | Redis down | Cache + queue + dedup | Health check; connection errors | App degrades: compute live (slower), in-memory dedup window, alert; PostgreSQL still authoritative |
| 10 | PostgreSQL down | Persistence + config reads | Health check | Readiness probe pulls pod; serve cached graph read-only; no writes until recovery |
| 11 | WebSocket storm (many clients, big repo) | One repo's viewers | Connection count metric | Room-scoped emits + diff-only payloads (send changes, not full graph); backpressure |
| 12 | Slack API failure | Notifications only | Breaker open | Retry queue; notifications are best-effort, never block graph updates |
| 13 | Poison message in queue | One consumer | Repeated failure on same msg | Max-retry → DLQ; consumer continues with next message |
| 14 | Secret leak (tokens) | Security | Audit | Tokens encrypted at rest; K8s Secrets / external secrets operator; rotate on suspicion |

---

## 19. Deployment Strategies

Rev 1 covered the Docker/K8s *mechanics*. This section covers the *strategy* — how you ship a new version without breaking live users, and how you roll back.

### 19.1 Which Strategy, and Why

| Strategy | What it is | Use it here? |
|---|---|---|
| **Recreate** | Stop old, start new (downtime) | **MVP only**, single instance on Railway/EC2 — acceptable for a side project's first weeks |
| **Rolling update** | Replace pods N at a time, old + new coexist briefly | **Default for K8s.** Zero-downtime, simple, native to a Deployment. Our recommendation once multi-replica |
| **Blue-Green** | Two full environments; flip traffic at the load balancer | Overkill for a single-service app; good talking point. Use if a release needs an all-or-nothing cutover |
| **Canary** | Route a small % of traffic to the new version, watch metrics, ramp | The *aspirational* answer: ship to 5% of installations, watch error rate + graph-compute latency, auto-rollback on regression |

**Recommended path:** Recreate (MVP) → Rolling (when you add replicas) → discuss Canary as the scale story. Don't over-claim canary on a project serving a handful of repos — interviewers respect "rolling now, canary when traffic justifies it."

### 19.2 The Hard Part — Zero-Downtime DB Migrations

Rolling updates mean **old and new code run against the same database simultaneously.** A naive `ALTER TABLE ... DROP COLUMN` deployed alongside old pods that still read that column = crashes. The fix is the **expand-contract (parallel change) pattern**:

```
EXPAND  → add new column/table, nullable, no FK constraints yet.
          Old code ignores it; new code can write it. Both versions run fine.
MIGRATE → backfill data; dual-write from new code if needed.
CONTRACT→ once ALL pods are new and reads are switched, drop the old column
          in a LATER, separate deploy.
```

> Interview soundbite: *"I never ship a destructive migration in the same release as the code that depends on it. Add-then-deploy, deploy-then-remove — two releases, never one. That's what makes rolling updates safe."*

`prisma migrate deploy` runs in the container `start.sh` before the server boots — but **only additive migrations** ride along with a rolling deploy; destructive ones are gated to a follow-up release.

### 19.3 Rollback & Safety Nets

- **Image rollback:** every build is tagged with `${github.sha}` (not just `latest`), so rollback is `kubectl rollout undo` or redeploying the previous SHA — deterministic, instant.
- **Feature flags:** the AI feature is behind `AI_ENABLED`; a bad AI release is disabled by a config flip, not a redeploy.
- **Health-gated rollout:** K8s `readinessProbe` on `/api/health` means a pod that can't reach PostgreSQL/Redis never receives traffic; a fully-broken new version fails readiness and the rollout halts automatically.
- **Smoke test in CD:** after deploy, the pipeline curls `/api/health` + one real endpoint; a red smoke test triggers auto-rollback.

### 19.4 Deployment Topologies

| Stage | Topology | Cost |
|---|---|---|
| **MVP / demo** | Single Railway service + Railway Postgres + Railway Redis, recreate deploys | ~$5–15/mo |
| **Public / open-source** | Single EC2 (docker-compose) OR Railway, HTTPS via Cloudflare, rolling via `docker compose up -d` | ~$15/mo |
| **Scale story (interview)** | K8s: 2–3 stateless app replicas + HPA, managed Postgres (RDS/Neon) + managed Redis (ElastiCache/Upstash), Nginx Ingress with WS upgrade, canary via Argo Rollouts | discuss, don't build |

---

## 20. Open Source Launch Strategy

### Making It Real (Get GitHub Stars)

This project's differentiator is that it's OPEN SOURCE with REAL USERS. Here's how:

**Week of Launch:**
1. Deploy publicly at prgraph.dev
2. Create GitHub App listing with screenshots and install button
3. Post on:
   - Hacker News: "Show HN: I built a PR dependency visualiser"
   - Reddit: r/programming, r/webdev, r/devops
   - Dev.to: "How I built a PR dependency graph with React Flow"
   - Twitter/X: Tag @reactflow, @github, @linear
4. Install it on 3-5 popular open-source repos (with maintainer permission) and screenshot the graphs

**README Must-Haves for GitHub Stars:**
- Animated GIF demo (3-second loop showing graph + merge + update)
- One-click install button (links to GitHub App install page)
- "Quick Start" that takes < 2 minutes
- Badges: CI status, license, GitHub stars
- Clean issue templates for bugs and features

**Resume Impact:**
```
PRGraph — Open Source PR Dependency Visualiser
github.com/you/prgraph | prgraph.dev | ⭐ XX stars
- Built interactive dependency graph for GitHub PRs using React Flow + TypeScript
- Graph algorithms (topological sort, cycle detection) identify merge-safe PRs
- Real-time updates via WebSocket + GitHub webhooks, Slack notifications
- Added AI semantic conflict analysis via a provider-agnostic LLM adapter
  (GPT-5.4-mini default), gated by an eval harness in CI; content-addressed
  response cache + budget breaker keep cost bounded
- Deployed with Docker, CI/CD via GitHub Actions, monitoring with Prometheus
```

---

## 21. Deployment Checklist — Go Live

- [ ] `docker compose up` starts app + postgres + redis cleanly
- [ ] GitHub App installs and fetches PRs for a test repo
- [ ] Dependency graph renders correctly in React Flow
- [ ] Merging a PR on GitHub triggers real-time graph update
- [ ] Slack notification arrives for unblocked PRs
- [ ] Landing page loads fast (SSR, < 2s)
- [ ] CI/CD pipeline green (badge in README)
- [ ] Deployed publicly with HTTPS
- [ ] Grafana dashboard shows 4 panels (screenshot for README)
- [ ] README has: architecture diagram, demo GIF, install button
- [ ] CONTRIBUTING.md, LICENSE (MIT), issue templates present
- [ ] Tested on a real repo with 10+ open PRs
- [ ] Record 2-minute demo video
- [ ] Submit to Hacker News / Reddit / Dev.to

**Phase 2 (AI) checklist:**
- [ ] `AI_ENABLED=false` → graph works fully on the heuristic engine (proves the fallback)
- [ ] `AI_ENABLED=true` → overlapping edges show TRUE_CONFLICT / CO_LOCATED + explanations
- [ ] Eval harness runs in CI and fails on F1 regression
- [ ] LLM cost + cache-hit-ratio panels visible in Grafana
- [ ] Budget breaker trips to fallback when the daily cap is hit (test with a low cap)
- [ ] `docs/AI_ARCHITECTURE.md` + model-choice decision matrix written

### Cost Estimate (Monthly)

| Service | Provider | Cost |
|---|---|---|
| Railway.app (app + postgres + redis) | Railway | ~$5-15/mo |
| OR EC2 t3.small (2 vCPU, 2GB) | AWS | ~$15/mo |
| Domain (prgraph.dev) | Namecheap | ~$10/year |
| SSL | Cloudflare | Free |
| Slack App | Slack | Free |
| GitHub App | GitHub | Free |
| LLM API (Phase 2, GPT-5.4-mini, cache-heavy) | OpenAI | ~$0–3/mo at portfolio scale (cache absorbs most calls) |
| **Total** | | **$5-18/month** |

---

## Final Word — Why This Project Wins Interviews

PRGraph is fundamentally different from the other two capstone ideas because it's **an open-source tool with real users**. Here's the hierarchy:

1. **Most freshers:** "I built a to-do app" → forgettable
2. **Good freshers:** "I built a complex project" → impressive
3. **You:** "I built an open-source tool that engineers actually install and use" → unforgettable

**For developer tools companies (Atlassian, Linear, JetBrains, Postman):**
- You built tooling FOR developers — that's their entire business model
- You understand developer workflows (PR review, merge conflicts, dependency chains)
- You open-sourced it — shows community mindset they value

**For AI-Engineer roles (and AI-heavy product teams):**
- You didn't just "call an API" — you wrapped an LLM in a provider-agnostic adapter, versioned prompts, gated CI on an eval set, cached content-addressed, and tracked cost. That's the MLOps discipline most freshers can't demonstrate
- You can defend your model choice with numbers ("F1 vs cost on my eval set"), not brand loyalty — exactly the judgment AI teams hire for
- The heuristic fallback shows you treat the LLM as one unreliable component in a system, not magic

**For product companies (Razorpay, CRED, Flipkart):**
- Graph algorithms (topological sort, cycle detection) — core CS fundamentals
- Real-time architecture (WebSocket + webhooks) — production patterns
- Pragmatic decisions (PostgreSQL over Neo4j, Redis over Kafka) — engineering maturity

**For DevOps-focused roles:**
- Docker, CI/CD, monitoring, scaling decisions — production-grade
- GitHub App + Slack integration — API orchestration
- Webhook reliability (dedup + retry + circuit breaker) — resilience engineering

**The magic sentence:** "I open-sourced it and it has XX GitHub stars. Engineers use it in production. Here's the live link."

No other fresher in the interview room will have that.

---

*Document prepared as a complete implementation guide for PRGraph — Open Source PR Dependency Visualiser (2026)*
