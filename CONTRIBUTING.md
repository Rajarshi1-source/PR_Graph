# Contributing to PRGraph

Thanks for your interest in improving PRGraph!

## Development setup

See the [Quickstart](README.md#quickstart-local) in the README. In short:

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis
npm run db:generate && npm run db:migrate
npm run dev
```

## Project conventions

The engineering rules live in [`.claude/skills/`](.claude/skills/) and are wired as global rules via
[`AGENTS.md`](AGENTS.md). Please skim the relevant skill before working in an area:

- **Graph engine / AI** — `prgraph-graph-ai`
- **Backend (routes, GitHub, queue, sockets)** — `prgraph-nextjs-backend` (+ `references/security-and-api.md`)
- **Frontend (App Router, React Flow)** — `prgraph-nextjs-frontend`
- **UI styling** — `prgraph-tailwind-shadcn`

Highlights:

- The graph engine (`src/lib/graph`) must stay **pure** — no I/O, no `Date.now`, no randomness — and
  fully unit-tested.
- Route handlers stay thin: validate with Zod → call a `lib/**` service → return a `Response`. Errors
  use the RFC 9457 `problem()` helper.
- Webhooks: verify HMAC on the raw body, dedupe, enqueue, return 202 fast.
- shadcn/ui components are owned in-repo (`src/components/ui`); theme via semantic tokens, ship dark mode.

## Before opening a PR

Run the full local gate (the same checks CI runs):

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Commit / PR guidelines

- Keep PRs focused and small where possible.
- Describe the "why", not just the "what".
- Add tests for engine/logic changes.

By contributing you agree your contributions are licensed under the [MIT License](LICENSE).
