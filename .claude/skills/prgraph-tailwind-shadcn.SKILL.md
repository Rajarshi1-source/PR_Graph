---
name: prgraph-tailwind-shadcn
description: >-
  Style the PRGraph UI with Tailwind CSS and shadcn/ui. Use whenever building or refactoring ANY
  visual component, theme, or layout: the custom React Flow PR node card with its SAFE / BLOCKED /
  DEADLOCKED status states, dependency edges, the graph legend and controls, the PR detail side panel,
  the conflict file list, repo dashboard cards, the merge-order panel, dark mode, accessibility, and
  responsive layout — or whenever Tailwind, shadcn, Radix, components.json, the cn() helper, theming
  via CSS variables, design tokens, or react-hook-form plus zod forms come up. Trigger even without an
  explicit ask when styling decisions are made, or when someone says make this look good or less
  generic. MANDATE: shadcn/ui components are copied INTO the repo at components/ui and edited there,
  never installed as an npm dependency; preserve Radix accessibility; theme via semantic tokens, never
  hardcoded colors; ship dark mode. Pair with prgraph-nextjs-frontend for component structure.
---

# Tailwind CSS + shadcn/ui — PRGraph UI

You style **PRGraph** with **Tailwind CSS + shadcn/ui**. PRGraph is a developer tool, so the bar is:
fast, dense-but-readable, keyboard-accessible, and dark-mode-native. The signature surface is the
React Flow graph, where each PR is a status-coloured card and edges encode conflict severity.

## Why this stack (state it confidently if asked)

- **Tailwind** keeps the bundle small and the styling co-located — important for a tool that should
  feel snappy. New code is **Tailwind v4** (CSS-first config via `@theme`), the default in a Next.js
  16 `create-next-app`; v3 is fine if the repo is already on it — match what `tailwind.config` /
  `globals.css` already use.
- **shadcn/ui** gives polished, accessible Radix-based components that you **own**: they are copied
  into `components/ui` and edited in-repo. This is a feature, not a workaround — you tune them.

## Critical rules (never violate)

- **shadcn components are copied in, never an npm dependency.** Add them with the CLI
  (`npx shadcn@latest add button dialog ...`); they land in `components/ui` and you edit them there.
- **React 19 (Next.js 16):** `ref` is a regular prop — current shadcn/ui source no longer uses
  `forwardRef`. When you add or edit a `components/ui` primitive, accept `ref` directly rather than
  reintroducing `forwardRef`; `npx shadcn@latest add` pulls the React-19-ready versions.
- **Compose classes with `cn()`** (the `clsx` + `tailwind-merge` helper in `lib/utils`) so variant
  and override classes merge correctly — never string-concatenate class names.
- **Theme via semantic tokens, never raw hex.** Colours come from CSS variables
  (`--background`, `--foreground`, `--primary`, plus the PRGraph status tokens below). A new colour
  means a new token, not an inline `#10b981`.
- **Ship dark mode** with `next-themes` and the token system; a dev tool that's light-only reads as
  unfinished.
- **Preserve Radix a11y.** Keep focus rings, `aria-*`, roles, and keyboard handlers that shadcn
  ships — don't strip them for looks. The graph must be operable by keyboard.
- **React Flow nodes are plain divs styled with Tailwind** — there's no shadcn "node" component;
  build PRNode from tokens + `cn()`.

## The PRGraph status colour system (the consistency anchor)

Every node, badge, legend swatch, and edge maps to one of three statuses. Define them **once** as
semantic tokens, then reference the token everywhere — never re-pick greens/ambers/reds per component.

```css
/* globals.css — light + dark, status tokens layered on the shadcn base */
:root {
  --status-safe:        142 71% 45%;   /* emerald  — no incoming blockers, merge now */
  --status-blocked:      38 92% 50%;   /* amber    — has dependencies, must wait */
  --status-deadlocked:    0 84% 60%;   /* red      — in a cycle, manual resolution */
  --status-safe-bg:     142 76% 96%;
  --status-blocked-bg:   48 96% 95%;
  --status-deadlocked-bg: 0 86% 97%;
}
.dark {
  --status-safe:        142 64% 52%;  --status-safe-bg:        142 30% 14%;
  --status-blocked:      38 95% 58%;  --status-blocked-bg:      38 40% 14%;
  --status-deadlocked:    0 84% 64%;  --status-deadlocked-bg:    0 40% 15%;
}
```

```ts
// tailwind: expose the tokens (v3 theme.extend.colors, or v4 @theme)
status: {
  safe:        'hsl(var(--status-safe))',        'safe-bg':       'hsl(var(--status-safe-bg))',
  blocked:     'hsl(var(--status-blocked))',     'blocked-bg':    'hsl(var(--status-blocked-bg))',
  deadlocked:  'hsl(var(--status-deadlocked))',  'deadlocked-bg': 'hsl(var(--status-deadlocked-bg))',
}
```

```ts
// components/graph/status.ts — single source of truth, imported by node, badge, legend
export const STATUS = {
  SAFE:       { ring: 'border-status-safe',       bg: 'bg-status-safe-bg',       label: 'Safe to merge' },
  BLOCKED:    { ring: 'border-status-blocked',    bg: 'bg-status-blocked-bg',    label: 'Has dependencies' },
  DEADLOCKED: { ring: 'border-status-deadlocked', bg: 'bg-status-deadlocked-bg', label: 'Deadlocked' },
} as const;
```

## Custom PR node (Tailwind, tokens, handles)

```tsx
// components/graph/PRNode.tsx
'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitPullRequest, FileCode, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS } from './status';
import type { PRNodeData } from '@/types/graph';

export function PRNode({ data, selected }: NodeProps<PRNodeData>) {
  const s = STATUS[data.status];
  return (
    <div
      role="button" tabIndex={0}
      aria-label={`PR ${data.prNumber}, ${s.label}`}
      className={cn(
        'w-72 rounded-lg border-2 shadow-sm transition-shadow hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        s.ring, s.bg, selected && 'ring-2 ring-primary',
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-3 !w-3" />
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <GitPullRequest className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold">#{data.prNumber}</span>
        <span className="ml-auto rounded-full bg-background/60 px-2 py-0.5 text-xs">{data.status}</span>
      </div>
      <p className="line-clamp-2 px-3 py-2 text-sm">{data.title}</p>
      <div className="flex items-center gap-3 rounded-b-lg bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><FileCode className="h-3 w-3" />{data.filesChanged}</span>
        {data.blockedBy.length > 0 && (
          <span className="flex items-center gap-1 text-status-blocked">
            <AlertTriangle className="h-3 w-3" />{data.blockedBy.length}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3" />
    </div>
  );
}
```

## Edge styling (conflict severity)

Map edge `type` to width/colour via the same tokens: `CRITICAL_BLOCK` → solid `status-deadlocked`,
thick; `BLOCKS` → `status-blocked`; `TOUCHES`/`CO_LOCATED` → dashed, muted. Keep stroke colours as
`hsl(var(--status-*))` so they track dark mode.

## Dark mode (next-themes + tokens)

```tsx
// components/layout/ThemeToggle.tsx
'use client';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';
export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
      <Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  );
}
```

Wrap the app in `ThemeProvider` (`attribute="class"`, `defaultTheme="system"`). Because every colour
is a token, dark mode is free — no per-component overrides.

## Forms (react-hook-form + zod + shadcn Form)

For the Slack config and alert-preference forms, use the shadcn `Form` primitives over react-hook-form
with a `zodResolver`. Validation messages render through `FormMessage`; keep labels associated for a11y.

## Accessibility checklist

- Visible focus ring on nodes, controls, and the side panel (`focus-visible:ring-2 ring-ring`).
- The graph is operable by keyboard (Tab between nodes, Enter to open the detail panel).
- Status is never colour-only — pair the colour with the text label/icon (colour-blind safe).
- Dialogs/side panels: Radix `Dialog`/`Sheet` give focus trap + Escape for free; keep them.

## Anti-patterns to fix on sight

| Anti-pattern | Fix |
|---|---|
| `npm install shadcn-ui` and importing from it | use the CLI to copy components into `components/ui`, edit there |
| Inline hex (`#10b981`) or per-component greens/reds | reference a status/shadcn token; add a token if missing |
| Hand-built class strings with template literals | `cn(...)` so `tailwind-merge` resolves conflicts |
| Light-mode-only | `next-themes` + tokens → dark mode for free |
| Stripping Radix `aria-*`/focus for aesthetics | keep a11y; restyle with tokens instead |
| Status conveyed by colour alone | add the label/icon next to the colour |
| Re-deriving status colours in node/badge/legend separately | import the one `STATUS` map |

## Quick reference

- Tailwind + shadcn/ui; shadcn components are **copied into `components/ui`** and owned in-repo.
- Three semantic status tokens (SAFE/BLOCKED/DEADLOCKED) drive nodes, badges, edges, legend.
- Compose with `cn()`; colours are CSS-variable tokens, never hex; dark mode via `next-themes`.
- React Flow nodes are token-styled divs; preserve Radix a11y; status is colour **+** label.
- Component structure → prgraph-nextjs-frontend; data/types → shared `types/graph`.
