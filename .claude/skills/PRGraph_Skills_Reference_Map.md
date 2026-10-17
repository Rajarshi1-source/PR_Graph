# PRGraph — Skill Set Reference Map

Every file in the skill set, what it owns, and how the files reference each other. Revised for
**Phase 3 (differentiators)**: line-level merge simulation, cross-file symbol impact, readiness-aware
merge plan, agent preflight API + MCP server + Check Run bot, plus the remaining nice-to-haves.

## Files in the set

| File | Role |
|---|---|
| `prgraph-graph-ai/SKILL.md` | Three layers: deterministic engine (regions, BLOCKS/TOUCHES/SEMANTIC/STACKED/INDIRECT, AT_RISK, diff3 deep verify), AI refinement (approx evidence only, conflict.v4 incl. symbol FOCUS, conflict + impact evals), planning (merge plan, what-if, preflight, workspaces, export) |
| `prgraph-nextjs-backend/SKILL.md` | Route Handlers, webhooks, Redis Streams, Socket.IO custom server — plus Phase-3 wiring: recompute coalescing, GitHub data surface, readiness fast path, Check Run bot, API tokens, preflight API, settings, `PROCESS_ROLE`, demo |
| `prgraph-nextjs-backend/references/security-and-api.md` | Auth/secrets/PII (§A.1 App permissions, §A.9 API tokens, §A.10 demo surface) + full REST/WS/webhook contract (§B.1–B.5, incl. `/api/v1/**`) |
| `prgraph-nextjs-frontend/SKILL.md` | App Router pages, React Flow canvas (`live`/`demo` modes), merge-plan panel, what-if, edge AI tooltips, history, export, workspace lens, org overview, Playwright E2E |
| `prgraph-tailwind-shadcn/SKILL.md` | Tokens (4 statuses incl. AT_RISK, 6 edge types), readiness chips, conflict-region blocks, a11y (axe gate) — base-nova on `@base-ui/react` |
| `../../SCALING.md` | Architecture and system-design decisions for scaling to millions of users |
| `../../PRGraph_Implementation_Plan.md` | Original 8-week plan + §22 Phase 3 and the revised-decisions table |
| `../../PRGraph_starter_code.md` | Part 1 runnable engine + tests; Part 2 eval harness (historical starter) |
| `../../PRGraph_eval_connectors.md` | Versioned prompt + adapter + diff-fetcher + eval wiring |
| `../../docs/AI_ARCHITECTURE.md` | AI layer design + model decision matrix (measured numbers only) |

## Cross-reference graph

```
prgraph-tailwind-shadcn ──► prgraph-nextjs-frontend            (component structure)
prgraph-nextjs-frontend ──► prgraph-tailwind-shadcn            (styling)
                        ──► prgraph-graph-ai                   (pure client-safe fns: whatIf, workspaces, toMermaid, normalize)
                        ──► prgraph-nextjs-backend             (API + socket contract + custom server)
                        ──► security-and-api.md §B.4           (WebSocket contract, schema v2 payload)
prgraph-nextjs-backend  ──► prgraph-graph-ai                  (graph, planning + LLM logic)
                        ──► references/security-and-api.md     (§A.1 permissions, §A.3 HMAC, §A.9 tokens,
                                                                §B.1 REST incl. /api/v1, §B.2 ProblemDetail,
                                                                §B.4 WS, §B.5 webhook events)
                        ──► SCALING.md                         (process roles, partitioning, budgets)
prgraph-graph-ai        ──► prgraph-nextjs-backend             (wiring: fetching, queue, Check Run, preflight API)
                        ──► PRGraph_starter_code.md            (original engine + eval harness)
                        ──► PRGraph_eval_connectors.md         (prompt + adapter + diff-fetcher)
                        ──► SCALING.md §4, §9                  (incremental facts, AI cost)
```

## Where each feature lives

| Feature | Engine (pure) | Backend wiring | UI |
|---|---|---|---|
| Line-level conflicts (A) | `lib/graph/patch/*`, `mergeSim.ts` | `lib/github/fileContents.ts`, `service.ts` deep verify | `ConflictRegions` in `PRDetailPanel`, edge labels |
| Cross-file symbol impact (B) | `lib/graph/symbols/*` | — (uses fetched patches) | SEMANTIC edges, panel symbol links |
| Merge plan + readiness (C) | `readiness.ts`, `mergePlan.ts`, `whatIf.ts` | `lib/github/readiness.ts`, readiness fast path | `MergePlanPanel`, CI chips, what-if |
| Preflight + MCP + Check Run (D) | `preflight.ts`, `bot/renderCheckSummary` | `/api/v1/**`, `lib/auth/apiToken.ts`, `lib/bot/publishChecks.ts` | settings: tokens + bot toggle; demo playground |
| Monorepo / multi-repo | `workspaces.ts` | `GET /api/overview` | workspace filter, dashboard health cards |
| Export | `export.ts` (`toMermaid`) | — | `ExportMenu` (PNG/SVG/Mermaid/JSON) |
| History | `diffGraphs.ts`, `normalize.ts` | `GET /graph/history/:snapshotId` | history page |

## Where each file goes in the repo

```
.claude/skills/
├── prgraph-graph-ai/SKILL.md
├── prgraph-nextjs-backend/
│   ├── SKILL.md
│   └── references/security-and-api.md
├── prgraph-nextjs-frontend/SKILL.md
├── prgraph-tailwind-shadcn/SKILL.md
└── _bundles/*.skill          ← zipped copies of the four skills (rebuild after edits)
```

The user-level `anthropic-skills:prgraph-*` copies installed outside this repo predate the Next.js 16
migration; the in-repo skills above are authoritative.
