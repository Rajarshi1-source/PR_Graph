import type { DependencyGraph, PRFile, PRWithFiles, Readiness } from "@/lib/graph/types";
import { buildDependencyGraph } from "@/lib/graph/buildDependencyGraph";
import { withMergePlan } from "@/lib/graph/mergePlan";
import { toReadiness, type CheckSignal, type RawReadiness } from "@/lib/graph/readiness";

/**
 * The public demo repo — static, fictional data run through the REAL pure engine. It exercises
 * every edge type and status (the E2E suite asserts on it, so classification changes must update
 * the expectations in e2e/demo-graph.spec.ts):
 *
 *   BLOCKS (exact)  #101→#102 session.ts L42/43 · #105→#114 cart.ts · #102→#104 cookies.ts L8
 *   INDIRECT        #101⇝#104 via #102
 *   TOUCHES         #107→#108 Button.tsx far apart · #105↔#106 package-lock.json (regenerable)
 *   SEMANTIC        #103 renames loadUser → #104 calls it
 *   DEADLOCK        #111 ↔ #112 each break a symbol the other uses
 *   STACKED         #109 → #110 (feat/payments-retry)
 *   BLOCKS (approx) #107→#115 logo.png (binary, no patch)
 *   readiness       CI failing (#109), CI running (#104, #114), review required (#102), draft (#113)
 */

export const DEMO_REPO = "acme/storefront";
const BASE_SHA = "b1a5e0c0ffee";

/** `@@ -start,len +start,len @@` hunk from body lines (' ' context, '-' removed, '+' added). */
function hunk(start: number, body: string[], context = ""): string {
  const oldLen = body.filter((l) => !l.startsWith("+")).length;
  const newLen = body.filter((l) => !l.startsWith("-")).length;
  const s = oldLen === 0 ? start - 1 : start;
  return [`@@ -${s},${oldLen} +${s},${newLen} @@${context ? ` ${context}` : ""}`, ...body].join("\n");
}

const f = (filename: string, patch: string | undefined, additions: number, deletions: number, status = "modified"): PRFile => ({
  filename,
  ...(patch !== undefined ? { patch } : {}),
  additions,
  deletions,
  status,
});

let shaCounter = 0x10;
const pr = (
  number: number,
  day: number,
  title: string,
  author: string,
  files: PRFile[],
  refs: { head?: string; base?: string } = {},
): PRWithFiles => ({
  number,
  title,
  author,
  createdAt: `2026-10-${String(day).padStart(2, "0")}T09:${String(number % 60).padStart(2, "0")}:00Z`,
  htmlUrl: `https://github.com/${DEMO_REPO}/pull/${number}`,
  headSha: `${(shaCounter++).toString(16).padStart(4, "0")}d3m0${number}`,
  baseSha: BASE_SHA,
  headRef: refs.head ?? `pr-${number}`,
  baseRef: refs.base ?? "main",
  draft: false,
  files,
});

export const demoPRs: PRWithFiles[] = [
  pr(101, 1, "Harden session token validation", "alice", [
    f("src/auth/session.ts", hunk(41, [" export function validateSession(token: string) {", "-  return verify(token);", "+  return verify(token, { clockTolerance: 5, audience: APP_ID });"], "export function validateSession"), 1, 1),
  ]),
  pr(102, 2, "Add refresh-token rotation", "bob", [
    f("src/auth/session.ts", hunk(43, ["-  // TODO: rotate refresh tokens", "+  rotateRefreshToken(token);"], "export function validateSession"), 1, 1),
    f("src/auth/rotation.ts", hunk(1, ["+export function rotateRefreshToken(token: string) {", "+  return issue(token, { ttl: '14d' });", "+}"]), 3, 0, "added"),
    f("src/auth/cookies.ts", hunk(8, ["-  sameSite: 'lax',", "+  sameSite: 'lax', maxAge: REFRESH_TTL,"]), 1, 1),
  ]),
  pr(103, 3, "Rename loadUser → findUser", "carol", [
    f("services/api/src/users/repo.ts", hunk(12, ["-export async function loadUser(id: string) {", "+export async function findUser(id: string) {", "   return db.users.get(id);"]), 1, 1),
  ]),
  pr(104, 4, "Profile page: show last login", "dan", [
    f("apps/web/src/app/profile/page.tsx", hunk(18, ["   const id = await sessionId();", "+  const user = await loadUser(id);", "+  const lastLogin = user.lastLoginAt;"]), 2, 0),
    f("src/auth/cookies.ts", hunk(8, ["-  sameSite: 'lax',", "+  sameSite: 'strict', // keep last-login cookie first-party"]), 1, 1),
  ]),
  pr(105, 5, "Checkout: apply coupon codes", "erin", [
    f("apps/web/src/checkout/cart.ts", hunk(10, ["-  const total = sum(items);", "+  const total = applyCoupon(sum(items), coupon);"], "export function cartTotal"), 1, 1),
    f("package-lock.json", hunk(2210, ["-      \"version\": \"2.1.0\",", "+      \"version\": \"2.2.0\","]), 1, 1),
  ]),
  pr(106, 6, "Bump react to 19.2.4", "frank", [
    f("package.json", hunk(20, ["-    \"react\": \"19.1.0\",", "+    \"react\": \"19.2.4\","]), 1, 1),
    f("package-lock.json", hunk(2210, ["-      \"version\": \"2.1.0\",", "+      \"version\": \"2.1.4\","]), 1, 1),
  ]),
  pr(107, 7, "Button: add loading state", "grace", [
    f("packages/ui/src/Button.tsx", hunk(30, ["-  return <button className={cls} {...props} />;", "+  return <button className={cls} aria-busy={loading} disabled={loading || disabled} {...props} />;"]), 1, 1),
    f("packages/ui/assets/logo.png", undefined, 0, 0),
  ]),
  pr(108, 8, "Button: visible focus ring", "heidi", [
    f("packages/ui/src/Button.tsx", hunk(80, ["+  'focus-visible:ring-2 focus-visible:ring-ring',"], "const variants = {"), 1, 0),
  ]),
  pr(109, 9, "Payments: retry webhook delivery", "ivan", [
    f("services/api/src/payments/webhook.ts", hunk(15, ["-  await deliver(event);", "+  await withRetry(() => deliver(event), { attempts: 5 });"]), 1, 1),
  ], { head: "feat/payments-retry" }),
  pr(110, 10, "Payments: idempotency keys", "judy", [
    f("services/api/src/payments/idempotency.ts", hunk(1, ["+export const idempotencyKey = (e: PaymentEvent) => `${e.id}:${e.attempt}`;"]), 1, 0, "added"),
  ], { head: "feat/payments-idempotency", base: "feat/payments-retry" }),
  pr(111, 11, "Pricing: switch to Money type", "mallory", [
    f("packages/core/src/money.ts", hunk(4, ["-export function formatPrice(cents: number) {", "+export function formatPrice(amount: Money, locale = 'en-US') {"]), 1, 1),
    f("packages/core/src/pricing.ts", hunk(22, ["+  const discounted = applyDiscount(total, customer.tier);"]), 1, 0),
  ]),
  pr(112, 12, "Discounts: tiered discount rules", "niaj", [
    f("packages/core/src/discount.ts", hunk(8, ["-export function applyDiscount(total: number, tier: Tier) {", "+export function applyTieredDiscount(total: Money, rules: TierRule[]) {"]), 1, 1),
    f("apps/web/src/checkout/summary.tsx", hunk(40, ["+      <dd>{formatPrice(subtotal)}</dd>"]), 1, 0),
  ]),
  pr(113, 13, "Docs: contributor guide refresh", "olivia", [
    f("docs/CONTRIBUTING.md", hunk(5, ["-Run `npm test`.", "+Run `npm test` and `npm run e2e`."]), 1, 1),
  ]),
  pr(114, 14, "Cart: persist to localStorage", "peggy", [
    f("apps/web/src/checkout/cart.ts", hunk(11, ["-  return total;", "+  persistCart(items);", "+  return total;"], "export function cartTotal"), 2, 1),
  ]),
  pr(115, 15, "Rebrand: new logo", "rupert", [f("packages/ui/assets/logo.png", undefined, 0, 0)]),
];

const green: CheckSignal[] = [
  { name: "build", state: "success" },
  { name: "unit", state: "success" },
  { name: "e2e", state: "success" },
];

const raw = (number: number, over: Partial<RawReadiness> = {}): RawReadiness => ({
  number,
  isDraft: false,
  mergeable: "MERGEABLE",
  reviewDecision: "APPROVED",
  checks: green,
  ...over,
});

const READINESS_RAW: RawReadiness[] = [
  raw(101),
  raw(102, { reviewDecision: "REVIEW_REQUIRED" }),
  raw(103),
  raw(104, { checks: [{ name: "build", state: "success" }, { name: "e2e", state: "pending" }] }),
  raw(105),
  raw(106),
  raw(107),
  raw(108),
  raw(109, { checks: [{ name: "build", state: "success" }, { name: "e2e", state: "failure" }] }),
  raw(110),
  raw(111),
  raw(112),
  raw(113, { isDraft: true, reviewDecision: null, checks: [] }),
  raw(114, { checks: [{ name: "build", state: "pending" }] }),
  raw(115),
];

export const demoReadiness = new Map<string, Readiness>(READINESS_RAW.map((r) => [String(r.number), toReadiness(r)]));

/** The demo graph: real engine + real merge planner over the fixtures. Pure and deterministic. */
export function buildDemoGraph(): DependencyGraph {
  return withMergePlan(buildDependencyGraph(demoPRs), demoReadiness);
}
