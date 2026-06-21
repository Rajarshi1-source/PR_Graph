---
name: prgraph-nextjs-frontend
description: >-
  Build the PRGraph frontend — the client side of the Next.js 16 App Router app in TypeScript with
  React 19.2. Use whenever creating or editing ANY frontend code: pages and layouts under app/,
  Server vs Client Components, the React Flow (xyflow) dependency-graph canvas with custom PR nodes
  and edges, dagre auto-layout, the Socket.IO client hook for real-time updates, the repo dashboard,
  data fetching from the backend Route Handlers, TanStack Query, Zod-validated types, SEO via
  generateMetadata, and loading/error/empty states — even when Next.js is not named. Trigger on App
  Router, server component, client component, use client, async params/searchParams, React Flow,
  xyflow, dagre, Socket.IO client, useGraph, generateMetadata, proxy.ts, Turbopack, TanStack Query,
  or Suspense. MANDATE: Next.js 16 App Router + React 19.2 + TypeScript strict, Server-Components-first,
  no Pages Router; request APIs (`params`, `searchParams`) are async Promises and must be awaited;
  React Flow is the graph renderer and must live in a Client Component. Pair with
  prgraph-tailwind-shadcn for styling and prgraph-nextjs-backend for the API.
---

# Next.js 16 App Router + React 19.2 — PRGraph Frontend

You are a senior frontend engineer building the client side of **PRGraph** on **Next.js 16 App
Router**, **React 19.2**, **TypeScript strict**. The headline surface is an interactive **React Flow**
dependency graph that updates in real time over Socket.IO. Server Components render the shell, SEO,
and initial data; Client Components own the interactive canvas and the live socket.

## Why this stack (state it confidently if asked)

- **Next.js 16 (not 14).** Next.js 14 is end-of-life with no security patches; 16 is the current
  stable line. The App Router model is the same, but v16 makes request APIs async (`params`,
  `searchParams`, `cookies()`, `headers()` are Promises — `await` them), defaults to Turbopack, and
  renames `middleware.ts` → `proxy.ts`.
- **App Router, Server-Components-first:** the landing page and repo shell are server-rendered for
  SEO (GitHub discoverability) and fast first paint; only the graph canvas and live updates ship JS.
- **No Pages Router.** Routing, layouts, loading/error boundaries, and metadata all use the App
  Router primitives.
- **React Flow (`@xyflow/react`)** is the renderer: pan/zoom/drag, custom nodes, handles, and
  layouting out of the box. It is client-only — it touches the DOM and holds interaction state.
- **React 19.2:** `ref` is a plain prop (no `forwardRef` for new components); the form-state hook is
  `useActionState` (not `useFormState`). The stable React Compiler can auto-memoize if enabled in
  `next.config.ts` (`reactCompiler: true`), but measure build time before turning it on.

## Critical rules (never violate)

- **Server Component by default; add `'use client'` only when you need interactivity, state,
  effects, or browser APIs.** The React Flow canvas, the Socket.IO hook, and `next-themes` toggles
  are client. Data-loading pages stay server where possible.
- **`params` / `searchParams` are async — await them.** They are Promises in Next.js 16; reading them
  synchronously is a removed pattern and errors.
- **Never reach a secret on the client.** Tokens, the GitHub App key, Slack secrets, and Prisma live
  only in Server Components / Route Handlers. Client code calls the API; it never imports `lib/db` or
  `lib/github`.
- **Types are shared, not duplicated.** The graph DTO (`GraphNode`, `GraphEdge`, `DependencyGraph`)
  is one type module imported by both server and client; never redefine node/edge shapes in the UI.
- **React Flow nodes/edges are controlled** via `useNodesState`/`useEdgesState`; memoize `nodeTypes`
  and `edgeTypes` outside render (defining them inline re-registers every render and kills perf).
- **Layout is computed, not authored.** Node `position` comes from dagre in a hook, not hardcoded.
- **Real-time is diff-applied.** The socket pushes a graph diff; apply it to React Flow state and
  animate the changed nodes — never full-replace the canvas on every event (it resets viewport).

## Server vs Client — the decision

```
Server Component   → app/page.tsx (landing, SEO), repo shell, initial graph fetch, dashboards
'use client'       → GraphCanvas (React Flow), useGraphSocket, ThemeToggle, any onClick/useState
```

```tsx
// app/repo/[owner]/[name]/page.tsx  — SERVER component: fetch initial graph, render shell
import { getInitialGraph } from '@/lib/graph/service';     // server-only
import { GraphCanvas } from '@/components/graph/GraphCanvas';
import { Suspense } from 'react';

// params is a Promise in Next.js 16.
type Props = { params: Promise<{ owner: string; name: string }> };

export default async function RepoPage({ params }: Props) {
  const { owner, name } = await params;                    // ← await before use
  const initial = await getInitialGraph(owner, name);      // SSR first paint
  return (
    <Suspense fallback={<GraphSkeleton />}>
      <GraphCanvas initialGraph={initial} repoId={initial.repoId} />  {/* client island */}
    </Suspense>
  );
}
```

> **Type-safe alternative.** Run `npx next typegen` and type the page with the generated helper:
> `export default async function RepoPage({ params }: PageProps<'/repo/[owner]/[name]'>)`.

## React Flow integration (the core of the UI)

```tsx
// components/graph/GraphCanvas.tsx
'use client';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { PRNode } from './PRNode';            // styled in prgraph-tailwind-shadcn
import { DependencyEdge } from './DependencyEdge';
import { useDagreLayout } from '@/hooks/useDagreLayout';
import { useGraphSocket } from '@/hooks/useGraphSocket';
import type { DependencyGraph } from '@/types/graph';

const nodeTypes = { prNode: PRNode };         // defined ONCE, module scope (perf)
const edgeTypes = { dependency: DependencyEdge };

export function GraphCanvas({ initialGraph, repoId }: { initialGraph: DependencyGraph; repoId: number }) {
  const laidOut = useDagreLayout(initialGraph);             // sets node.position
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laidOut.edges);

  // Real-time: apply diffs from the webhook-driven socket, don't full-replace
  useGraphSocket(repoId, (diff) => {
    setNodes((cur) => applyNodeDiff(cur, diff));            // animate SAFE←→BLOCKED transitions
    setEdges((cur) => applyEdgeDiff(cur, diff));
  });

  return (
    <ReactFlow
      nodes={nodes} edges={edges}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      fitView proOptions={{ hideAttribution: false }}
    >
      <Background /><Controls /><MiniMap />
    </ReactFlow>
  );
}
```

```tsx
// hooks/useDagreLayout.ts  — automatic top-to-bottom hierarchy
import dagre from '@dagrejs/dagre';
export function useDagreLayout(graph: DependencyGraph) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((n) => g.setNode(n.id, { width: 288, height: 132 }));
  graph.edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return {
    nodes: graph.nodes.map((n) => ({ ...n, position: { x: g.node(n.id).x, y: g.node(n.id).y } })),
    edges: graph.edges,
  };
}
```

## Real-time hook (Socket.IO client)

```tsx
// hooks/useGraphSocket.ts
'use client';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { GraphDiff } from '@/types/graph';

let socket: Socket | null = null;            // one connection per tab

export function useGraphSocket(repoId: number, onUpdate: (d: GraphDiff) => void) {
  useEffect(() => {
    socket ??= io({ path: '/api/socket', transports: ['websocket'] });
    socket.emit('graph:subscribe', String(repoId));
    const handler = (payload: { diff: GraphDiff }) => onUpdate(payload.diff);
    socket.on('graph:updated', handler);
    return () => { socket?.emit('graph:unsubscribe', String(repoId)); socket?.off('graph:updated', handler); };
  }, [repoId, onUpdate]);
}
```

The server event contract (`graph:subscribe`, `graph:current`, `graph:updated`) is owned by
prgraph-nextjs-backend (`references/security-and-api.md` §B.4) — keep the client in sync with it.
The socket is served by the custom Node server (see prgraph-nextjs-backend), so dev runs that server
directly (`tsx watch server/websocket.ts`), not `next dev`.

## Data fetching — server first, TanStack Query for live client data

- **Initial + SEO data:** fetch in the Server Component (`async` page), pass as props. No client
  fetch waterfall on first paint.
- **Client-side live/refetchable data** (dashboard lists, manual re-sync status): TanStack Query
  with the backend Route Handlers; validate responses with the **shared Zod schema** before use.

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { ReposResponse } from '@/types/api';        // Zod schema
export function useRepos() {
  return useQuery({
    queryKey: ['repos'],
    queryFn: async () => ReposResponse.parse(await (await fetch('/api/repos')).json()),
  });
}
```

> **Next.js 16 caching APIs (when you use tag revalidation):** `revalidateTag` now requires a
> `cacheLife` profile — `revalidateTag('repos', 'max')`; the single-arg form is removed. Use
> `updateTag('repos')` in a Server Action for read-your-writes (the user sees their change
> immediately, e.g. right after connecting a repo). `"use cache"` / `cacheTag` / `cacheLife` require
> the `cacheComponents: true` opt-in in `next.config.ts` — PRGraph's live data is socket-driven, so
> adopt Cache Components deliberately rather than by default.

## SEO (generateMetadata) + boundaries

```tsx
// app/repo/[owner]/[name]/page.tsx
type Props = { params: Promise<{ owner: string; name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, name } = await params;                    // ← await; params is a Promise in 16
  return {
    title: `${owner}/${name} — PR dependency graph | PRGraph`,
    description: `See which PRs are safe to merge in ${owner}/${name}.`,
    openGraph: { images: ['/og-image.png'] },
  };
}
```

Use `loading.tsx` (skeleton) and `error.tsx` (boundary) per route segment; ship explicit empty states
(no PRs, no dependencies — "everything is safe to merge 🎉").

## Route protection — `proxy.ts` (replaces `middleware.ts`)

Gate authenticated routes with `proxy.ts` (Next.js 16 renamed `middleware.ts`). Keep it a lightweight
redirect; the real session check lives server-side.

```ts
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

## File structure (frontend slice)

```
app/{layout,page}.tsx · app/(auth)/login · app/dashboard · app/repo/[owner]/[name]/{page,loading,error}.tsx
components/graph/{GraphCanvas,PRNode,DependencyEdge,GraphLegend,PRDetailPanel,MergeOrderPanel}.tsx
hooks/{useDagreLayout,useGraphSocket,useRepos}.ts
types/{graph,api}.ts        // shared DTOs + Zod schemas
src/proxy.ts                // route gate (replaces middleware.ts)
```

## Anti-patterns to fix on sight

| Anti-pattern | Fix |
|---|---|
| Reading `params` / `searchParams` synchronously | `await` them — they are Promises in Next.js 16 |
| `'use client'` at the top of a page that only fetches data | keep it a Server Component; isolate the client island |
| Importing `lib/db` / `lib/github` into a client component | client calls the API; server-only modules stay server |
| `nodeTypes`/`edgeTypes` defined inside the component | hoist to module scope and memoize |
| Hardcoding node `position` | compute with dagre in a hook |
| Full-replacing nodes/edges on every socket event | apply a diff; preserve viewport; animate changes |
| Re-declaring `GraphNode`/`GraphEdge` in the UI | import the shared `types/graph` module |
| Pages Router (`pages/`, `getServerSideProps`) | App Router (`app/`, async Server Components) |
| `middleware.ts` for auth gating | `proxy.ts` (export `proxy`, Node.js runtime) |
| `revalidateTag('x')` single-arg | `revalidateTag('x', 'max')`, or `updateTag` for read-your-writes |
| `forwardRef` for a brand-new component | React 19: `ref` is a normal prop |
| Trusting `fetch().json()` shape blindly | parse with the shared Zod schema |

## Quick reference

- Next.js **16** App Router, **React 19.2**, TypeScript strict, **Server-Components-first**; React Flow is client-only.
- `params` / `searchParams` are **async** — `await` them in pages and `generateMetadata`.
- Server page fetches initial graph + sets `generateMetadata`; `GraphCanvas` is the client island.
- React Flow: controlled `useNodesState`/`useEdgesState`, module-scope `nodeTypes`, dagre layout hook.
- Real-time: `useGraphSocket` subscribes to `repo:{id}`, applies diffs, animates status changes.
- Live client data: TanStack Query + shared Zod validation; secrets never touch the client.
- `middleware.ts` → `proxy.ts`; caching: `revalidateTag(tag,'max')` / `updateTag`; React 19 `ref`-as-prop.
- Styling → prgraph-tailwind-shadcn; API + socket contract + custom server → prgraph-nextjs-backend.
