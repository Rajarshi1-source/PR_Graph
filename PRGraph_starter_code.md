# PRGraph — Starter Code
## (1) Dependency-Graph Engine [TypeScript] + (2) AI Semantic-Conflict Eval Harness [TypeScript]

> Drop-in starters for the two highest-value pieces in the plan: the **deterministic graph engine**
> (PRGraph's algorithmic spine) and the **AI conflict eval harness** with a **labeled fixture set**
> (the Phase-2 quality gate). Everything is TypeScript — PRGraph is a single-language repo, so unlike
> NaukriNearby there is no Python here. Align imports/paths to your structure (§5 of the plan).

---

# PART 1 — Dependency-Graph Engine (pure, deterministic, fully testable)

**Why:** this is the core algorithm and the thing interviewers will probe. Keeping it **pure** (data
in → graph out, no I/O, no clock, no randomness) is what makes it 100%-unit-testable and lets the AI
layer (Part 2) sit on top as an optional refinement. Build = inverted index → edges → classify →
Kahn topological sort → DFS cycle detection.

### 1.1 Types — `src/lib/graph/types.ts`

```typescript
export type NodeStatus = 'SAFE' | 'BLOCKED' | 'DEADLOCKED';
export type EdgeType = 'TOUCHES' | 'BLOCKS' | 'CRITICAL_BLOCK' | 'CO_LOCATED';

export interface PRFile { filename: string; additions: number; deletions: number; patch?: string; }
export interface PRWithFiles {
  number: number; title: string; author: string; createdAt: string; htmlUrl: string;
  files: PRFile[];
}
export interface GraphEdge {
  id: string; source: string; target: string; type: EdgeType; sharedFiles: string[];
}
export interface GraphNode {
  id: string; type: 'prNode'; position: { x: number; y: number };
  data: {
    prNumber: number; title: string; author: string; createdAt: string; htmlUrl: string;
    filesChanged: number; status: NodeStatus; blockedBy: string[]; blocking: string[];
  };
}
export interface MergeOrder { levels: string[][]; inCycle: string[]; totalLevels: number; }
export interface DependencyGraph {
  nodes: GraphNode[]; edges: GraphEdge[]; mergeOrder: MergeOrder; cycles: string[][];
  stats: { totalPRs: number; safePRs: number; blockedPRs: number; deadlockedPRs: number; totalDependencies: number };
}
```

### 1.2 Build the graph — `src/lib/graph/buildDependencyGraph.ts`

```typescript
import {
  PRWithFiles, DependencyGraph, GraphEdge, GraphNode, NodeStatus, EdgeType,
} from './types';
import { topologicalSort } from './topologicalSort';
import { detectCycles } from './cycleDetection';

const earlierFirst = (a: PRWithFiles, b: PRWithFiles): [PRWithFiles, PRWithFiles] =>
  new Date(a.createdAt) <= new Date(b.createdAt) ? [a, b] : [b, a];

export function buildDependencyGraph(prs: PRWithFiles[]): DependencyGraph {
  // 1. inverted index: filename -> PRs touching it
  const byFile = new Map<string, PRWithFiles[]>();
  for (const pr of prs)
    for (const f of pr.files) {
      const arr = byFile.get(f.filename);
      if (arr) arr.push(pr); else byFile.set(f.filename, [pr]);
    }

  // 2. pairwise overlaps -> edges (earlier PR blocks the later one)
  const edges = new Map<string, GraphEdge>();
  for (const [filename, touch] of byFile) {
    if (touch.length < 2) continue;
    for (let i = 0; i < touch.length; i++)
      for (let j = i + 1; j < touch.length; j++) {
        const [a, b] = earlierFirst(touch[i], touch[j]);
        const id = `${a.number}-${b.number}`;
        const e = edges.get(id);
        if (e) e.sharedFiles.push(filename);
        else edges.set(id, { id, source: String(a.number), target: String(b.number), type: 'BLOCKS', sharedFiles: [filename] });
      }
  }

  // 3. classify edge severity by overlap count
  for (const e of edges.values())
    e.type = e.sharedFiles.length >= 3 ? 'CRITICAL_BLOCK'
           : e.sharedFiles.length === 1 ? 'TOUCHES' : 'BLOCKS';

  const edgeList = [...edges.values()];

  // 4. cycles + in-degree -> node status
  const cycles = detectCycles(prs.map((p) => String(p.number)), edgeList);
  const inCycle = new Set(cycles.flat());
  const incoming = new Map<string, number>(prs.map((p) => [String(p.number), 0]));
  for (const e of edgeList) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);

  const classify = (id: string): NodeStatus =>
    inCycle.has(id) ? 'DEADLOCKED' : (incoming.get(id) ?? 0) === 0 ? 'SAFE' : 'BLOCKED';

  const nodes: GraphNode[] = prs.map((pr) => ({
    id: String(pr.number), type: 'prNode', position: { x: 0, y: 0 },
    data: {
      prNumber: pr.number, title: pr.title, author: pr.author, createdAt: pr.createdAt, htmlUrl: pr.htmlUrl,
      filesChanged: pr.files.length, status: classify(String(pr.number)),
      blockedBy: edgeList.filter((e) => e.target === String(pr.number)).map((e) => e.source),
      blocking: edgeList.filter((e) => e.source === String(pr.number)).map((e) => e.target),
    },
  }));

  return {
    nodes, edges: edgeList,
    mergeOrder: topologicalSort(nodes, edgeList), cycles,
    stats: {
      totalPRs: prs.length,
      safePRs: nodes.filter((n) => n.data.status === 'SAFE').length,
      blockedPRs: nodes.filter((n) => n.data.status === 'BLOCKED').length,
      deadlockedPRs: nodes.filter((n) => n.data.status === 'DEADLOCKED').length,
      totalDependencies: edgeList.length,
    },
  };
}
```

### 1.3 Kahn topological sort (merge order as levels) — `src/lib/graph/topologicalSort.ts`

```typescript
import { GraphNode, GraphEdge, MergeOrder } from './types';

export function topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): MergeOrder {
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  const levels: string[][] = [];
  let frontier = [...indeg].filter(([, d]) => d === 0).map(([id]) => id); // level 0 = merge now

  while (frontier.length) {
    levels.push(frontier);
    const next: string[] = [];
    for (const id of frontier)
      for (const nb of adj.get(id) ?? []) {
        const d = (indeg.get(nb) ?? 0) - 1;
        indeg.set(nb, d);
        if (d === 0) next.push(nb);
      }
    frontier = next;
  }

  const processed = new Set(levels.flat());
  const inCycle = nodes.filter((n) => !processed.has(n.id)).map((n) => n.id);
  return { levels, inCycle, totalLevels: levels.length };
}
```

### 1.4 DFS 3-colour cycle detection — `src/lib/graph/cycleDetection.ts`

```typescript
import { GraphEdge } from './types';

/** Returns the node ids that participate in at least one cycle (back edge via grey-on-grey). */
export function detectCycles(nodeIds: string[], edges: GraphEdge[]): string[][] {
  const adj = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) adj.get(e.source)?.push(e.target);

  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>(nodeIds.map((id) => [id, WHITE]));
  const stack: string[] = [];
  const cycles: string[][] = [];

  const dfs = (u: string) => {
    color.set(u, GREY); stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GREY) {                  // back edge -> cycle
        const i = stack.indexOf(v);
        if (i >= 0) cycles.push(stack.slice(i));
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    color.set(u, BLACK); stack.pop();
  };

  for (const id of nodeIds) if (color.get(id) === WHITE) dfs(id);
  return cycles;
}
```

### 1.5 Vitest suite — `src/lib/graph/__tests__/graph.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildDependencyGraph } from '../buildDependencyGraph';
import { PRWithFiles } from '../types';

const pr = (number: number, createdAt: string, files: string[]): PRWithFiles => ({
  number, title: `PR ${number}`, author: 'a', createdAt, htmlUrl: '',
  files: files.map((f) => ({ filename: f, additions: 1, deletions: 0 })),
});

describe('buildDependencyGraph', () => {
  it('marks non-overlapping PRs SAFE', () => {
    const g = buildDependencyGraph([pr(1, '2026-01-01', ['a.ts']), pr(2, '2026-01-02', ['b.ts'])]);
    expect(g.stats.safePRs).toBe(2);
    expect(g.edges).toHaveLength(0);
  });

  it('earlier PR blocks the later one on a shared file', () => {
    const g = buildDependencyGraph([pr(1, '2026-01-01', ['a.ts']), pr(2, '2026-01-02', ['a.ts'])]);
    const e = g.edges[0];
    expect(e.source).toBe('1');                 // earlier
    expect(e.target).toBe('2');                 // later, blocked
    expect(g.nodes.find((n) => n.id === '1')!.data.status).toBe('SAFE');
    expect(g.nodes.find((n) => n.id === '2')!.data.status).toBe('BLOCKED');
  });

  it('classifies CRITICAL_BLOCK on 3+ shared files', () => {
    const g = buildDependencyGraph([pr(1, '2026-01-01', ['a','b','c']), pr(2, '2026-01-02', ['a','b','c'])]);
    expect(g.edges[0].type).toBe('CRITICAL_BLOCK');
  });

  it('produces correct Kahn levels for a chain', () => {
    const g = buildDependencyGraph([
      pr(1, '2026-01-01', ['a']), pr(2, '2026-01-02', ['a','b']), pr(3, '2026-01-03', ['b']),
    ]);
    expect(g.mergeOrder.levels[0]).toContain('1');   // merge now
    expect(g.mergeOrder.totalLevels).toBeGreaterThanOrEqual(2);
  });
});
```

### 1.6 Why this is correct (interview talking points)

- **Pure & deterministic:** no I/O or clock inside the engine → identical input always yields the
  identical graph, so it's trivially testable and cacheable.
- **In memory, not SQL:** under ~500 nodes; Kahn + DFS are linear (`O(V+E)`); recursive SQL CTEs would
  be fragile and unreadable.
- **Status semantics:** SAFE = zero incoming blockers (merge now); BLOCKED = has blockers; DEADLOCKED
  = in a cycle (needs a human). Merge order falls straight out of Kahn's levels.
- **Idempotent recompute:** because it's a pure function of current PR state, out-of-order webhooks
  don't matter — you recompute the whole graph, not deltas.

---

# PART 2 — AI Semantic-Conflict Eval Harness (+ labeled fixture set)

**Why:** the AI layer (prgraph-graph-ai) is non-deterministic, so it needs a test the way the engine
has unit tests. This harness runs the analyzer over a **hand-labeled fixture set** of PR diff pairs
and computes precision/recall/F1; it gates CI so a prompt or model change that quietly regresses can't
merge. This is the answer to "how do you know your AI feature works?"

### 2.1 The labeled fixture set — `evals/labeled-pairs.json` (the starter the plan calls for)

Each case is two real diff hunks plus the **human label**. Keep these **disjoint from the prompt's
few-shot examples** so the eval measures generalization, not memorization.

```json
[
  {
    "id": "same-fn-rewrite",
    "label": "TRUE_CONFLICT",
    "prA": { "number": 42, "patch": "@@ -10,6 +10,8 @@ export function validateToken(t: string) {\n-  return verify(t);\n+  const decoded = verify(t);\n+  return decoded?.exp > Date.now() ? decoded : null;\n }" },
    "prB": { "number": 57, "patch": "@@ -10,4 +10,7 @@ export function validateToken(t: string) {\n-  return verify(t);\n+  if (!t) throw new Error('no token');\n+  return verify(t);\n }" }
  },
  {
    "id": "import-vs-far-fn",
    "label": "CO_LOCATED",
    "prA": { "number": 60, "patch": "@@ -1,2 +1,3 @@\n import { verify } from './jwt';\n+import { logger } from './log';\n" },
    "prB": { "number": 63, "patch": "@@ -120,4 +120,6 @@ export function refreshSession() {\n-  return next();\n+  logger.info('refresh');\n+  return next();\n }" }
  },
  {
    "id": "adjacent-different-fields",
    "label": "CO_LOCATED",
    "prA": { "number": 70, "patch": "@@ -5,3 +5,4 @@ interface User {\n   id: number;\n+  email: string;\n }" },
    "prB": { "number": 71, "patch": "@@ -5,3 +5,4 @@ interface User {\n   id: number;\n+  phone: string;\n }" }
  },
  {
    "id": "overlapping-lines-same-block",
    "label": "TRUE_CONFLICT",
    "prA": { "number": 80, "patch": "@@ -3,3 +3,3 @@ const config = {\n-  timeout: 5000,\n+  timeout: 10000,\n }" },
    "prB": { "number": 81, "patch": "@@ -3,3 +3,3 @@ const config = {\n-  timeout: 5000,\n+  timeout: 3000,\n }" }
  },
  {
    "id": "rename-vs-call",
    "label": "TRUE_CONFLICT",
    "prA": { "number": 90, "patch": "@@ -1,3 +1,3 @@\n-export function getUser() {}\n+export function fetchUser() {}\n" },
    "prB": { "number": 91, "patch": "@@ -40,2 +40,2 @@\n-  return getUser();\n+  return getUser().then(x => x);\n" }
  },
  {
    "id": "different-helpers-same-file",
    "label": "CO_LOCATED",
    "prA": { "number": 95, "patch": "@@ -10,3 +10,4 @@ function formatDate() {\n   return d;\n+  // tz fix\n }" },
    "prB": { "number": 96, "patch": "@@ -200,3 +200,4 @@ function parseCurrency() {\n   return n;\n+  // paise fix\n }" }
  }
]
```

> Ship ~30–40 of these (the six above are the seed). Pull real pairs from your own repos and
> hand-label them. A balanced mix of TRUE_CONFLICT / CO_LOCATED / a few UNCERTAIN is what makes the F1
> number meaningful.

### 2.2 The eval runner — `evals/conflict.eval.ts`

```typescript
import labeled from './labeled-pairs.json';
import { analyzeConflict } from '../src/lib/ai/conflictAnalyzer';
import { makeAdapter } from '../src/lib/ai/adapters/factory';   // reads LLM_PROVIDER env
import fs from 'node:fs';

const TARGET_F1 = 0.80;
const BASELINE = new URL('./baseline.json', import.meta.url);

type Label = 'TRUE_CONFLICT' | 'CO_LOCATED' | 'UNCERTAIN';
interface Case { id: string; label: Label; prA: { patch: string }; prB: { patch: string }; }

async function run() {
  const adapter = makeAdapter();           // e.g. openai:gpt-5.4-mini
  let tp = 0, fp = 0, fn = 0, n = 0;

  for (const c of labeled as Case[]) {
    const { verdict } = await analyzeConflict(adapter, c.prA.patch, c.prB.patch);
    const pred = verdict === 'TRUE_CONFLICT';
    const gold = c.label === 'TRUE_CONFLICT';
    if (pred && gold) tp++; else if (pred && !gold) fp++; else if (!pred && gold) fn++;
    n++;
    console.log(`  ${c.id.padEnd(28)} pred=${verdict.padEnd(13)} gold=${c.label}`);
  }

  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);
  const metrics = { precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +f1.toFixed(3), n };

  console.log('\n==============================');
  console.log('SEMANTIC-CONFLICT EVAL');
  console.log(`  precision=${metrics.precision}  recall=${metrics.recall}  F1=${metrics.f1}  (n=${n})`);
  console.log('==============================');
  return metrics;
}

(async () => {
  const m = await run();
  const mode = process.argv[2];

  if (mode === '--save-baseline') {
    fs.writeFileSync(BASELINE, JSON.stringify(m, null, 2));
    console.log('saved baseline');
    return;
  }
  if (mode === '--ci') {
    if (m.f1 < TARGET_F1) { console.error(`❌ F1 ${m.f1} < target ${TARGET_F1}`); process.exit(1); }
    if (fs.existsSync(BASELINE)) {
      const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
      if (base.f1 - m.f1 > 0.05) { console.error(`❌ F1 regressed ${base.f1} → ${m.f1}`); process.exit(1); }
    }
    console.log('✅ eval gate passed');
  }
})();
```

### 2.3 `evals/baseline.json` (example — via `--save-baseline`)

```json
{ "precision": 0.9, "recall": 0.86, "f1": 0.88, "n": 36 }
```

### 2.4 CI wiring (matches the plan's §15 MLOps gate)

```yaml
  semantic-conflict-eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }          # Node 24 LTS
      - run: npm ci
      - run: npx tsx evals/conflict.eval.ts --ci
        env:
          LLM_PROVIDER: openai:gpt-5.4-mini
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          REDIS_URL: redis://localhost:6379    # cache makes reruns near-free
```

### 2.5 Why this is correct (interview talking points)

- **Tests a non-deterministic component:** the analyzer is graded against human labels, so a prompt or
  model change that quietly got worse fails CI — same discipline as a unit test.
- **No data leakage:** the prompt's few-shot examples are deliberately different from the fixtures, so
  F1 reflects generalization, not memorization.
- **Cheap to rerun:** the content-addressed Redis cache (`sha256(promptVersion+diffA+diffB)`) means
  the eval is near-free after the first run.

---

## How to talk about this code in an interview

**Graph engine:** *"The dependency engine is a pure function — PRs and their changed files in, a DAG
out. I build an inverted index from files to PRs, create a blocking edge from the earlier PR to the
later one on every overlap, classify severity by how many files overlap, then run Kahn's algorithm for
the merge order and a 3-colour DFS for deadlocks. It's `O(V+E)`, fully unit-tested, and because it's
pure I can recompute the whole graph on every webhook instead of fiddling with deltas — which sidesteps
GitHub's lack of webhook ordering guarantees."*

**AI eval:** *"My AI conflict analyzer has a test suite. I keep ~36 hand-labeled diff pairs, run the
analyzer over them, and compute precision/recall/F1. It gates CI: if a prompt or model change drops F1
below threshold or regresses against the baseline, the build fails. The few-shot examples in the
prompt are disjoint from the eval set, so the score is generalization, not memorization. And the
content-addressed cache makes reruns essentially free."*

Both answers, backed by code you wrote, put you ahead of nearly every junior candidate — and the
"AI feature with an eval gate" story is exactly what AI-Engineer panels are listening for.
