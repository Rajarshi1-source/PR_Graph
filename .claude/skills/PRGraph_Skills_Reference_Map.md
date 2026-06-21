# PRGraph — Skill Set Reference Map (verified complete)

Both assets you flagged as "missing" **already exist, are complete, and are Next.js 16-consistent.**
This map shows every file in the set and confirms each cross-reference resolves — nothing dangles.

## Files in the set

| File | Role | Lines | Status |
|---|---|---|---|
| `prgraph-graph-ai/SKILL.md` | Graph engine + AI conflict analyzer + MLOps (Weeks 7–8 differentiator) | 217 | ✅ present, version-agnostic (no Next.js coupling) |
| `prgraph-nextjs-backend/SKILL.md` | Backend project rules (Route Handlers, webhooks, Redis Streams, Socket.IO custom server) | 398 | ✅ Next.js 16 + Node 24 |
| `prgraph-nextjs-backend/references/security-and-api.md` | Auth/secrets/PII + full REST/WS/webhook contract | 213 | ✅ Next.js 16; has §A.1–A.8, §B.1–B.5 |
| `prgraph-nextjs-frontend/SKILL.md` | Frontend project rules (React Flow, async params, Socket.IO client) | 273 | ✅ Next.js 16 + React 19.2 |
| `prgraph-tailwind-shadcn/SKILL.md` | UI/styling rules (status tokens, dark mode, a11y) | 192 | ✅ Tailwind v4 + React 19 |
| `PRGraph_Implementation_Plan.md` | 8-week plan; §9.1 custom-server Dockerfile | — | ✅ Next.js 16; standalone-free image |
| `PRGraph_starter_code.md` | Part 1 runnable engine + tests; Part 2 eval harness | — | ✅ pure TS |
| `PRGraph_eval_connectors.md` | Versioned prompt + adapter + diff-fetcher + eval wiring | — | ✅ |

## Cross-reference graph (every arrow resolves)

```
prgraph-tailwind-shadcn ──► prgraph-nextjs-frontend            (component structure)
prgraph-nextjs-frontend ──► prgraph-tailwind-shadcn            (styling)
                        ──► prgraph-nextjs-backend             (API + socket contract + custom server)
                        ──► security-and-api.md §B.4           ✅ exists (WebSocket event contract)
prgraph-nextjs-backend  ──► prgraph-graph-ai                  (graph + LLM logic)
                        ──► references/security-and-api.md     ✅ exists, bundled in the skill
                            §A.3 webhook security              ✅
                            §B.2 ProblemDetail error shape     ✅
                            §B.4 WebSocket contract            ✅
                            §B.5 webhook event contract        ✅
prgraph-graph-ai        ──► prgraph-nextjs-backend             (wiring)
                        ──► PRGraph_starter_code.md Part 1     ✅ (runnable engine + Vitest)
                        ──► PRGraph_starter_code.md Part 2     ✅ (eval harness)
                        ──► PRGraph_eval_connectors.md         ✅ (prompt + adapter + diff-fetcher)
PRGraph_eval_connectors ──► prgraph-graph-ai LLMAdapter        ✅
Implementation Plan §9.1 ─► server/websocket.ts (custom)       ✅ matches backend skill scripts
```

No dangling references. The set is closed: the three "project-rule" skills
(backend / frontend / tailwind-shadcn) plus the `prgraph-graph-ai` skill, the shared
`security-and-api.md` reference, and the three planning docs all point only at things that exist.

## Why these two looked missing

- **`prgraph-graph-ai` skill:** in the Next.js 16 migration it needed no edits (pure TypeScript, no
  framework coupling), so it wasn't repackaged into the outputs — only the three skills that changed
  were. It existed all along; it just wasn't re-handed-over. It is included here as a clean `.skill`.
- **`security-and-api.md`:** it was delivered only *inside* the `prgraph-nextjs-backend.skill` zip
  (at `references/security-and-api.md`), never as a standalone file, so it was invisible in the
  outputs folder. A standalone copy is included here.

## Where each file goes in the repo

```
.claude/skills/
├── prgraph-graph-ai/SKILL.md
├── prgraph-nextjs-backend/
│   ├── SKILL.md
│   └── references/security-and-api.md      ← canonical location (bundled with the backend skill)
├── prgraph-nextjs-frontend/SKILL.md
└── prgraph-tailwind-shadcn/SKILL.md
```

Each Claude Code skill is self-contained, so `security-and-api.md` lives under the **backend skill's**
`references/` directory (that is what the backend skill's relative link `references/security-and-api.md`
resolves to). The standalone copy provided here is for visibility/diffing; install it at the path above.

## One consistency fix applied this round

The backend skill's production run script was `tsx server/websocket.ts`, but the reworked §9.1
Dockerfile compiles the custom server with esbuild and runs `node dist/server.mjs`. The skill now
documents the esbuild `build:server` script and `node dist/server.mjs` as the production path (with
`tsx` kept for dev and noted as the simpler prod alternative), so the skill and the Dockerfile agree.
