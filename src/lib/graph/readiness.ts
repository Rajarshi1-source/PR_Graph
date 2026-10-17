import type { CiState, Readiness, ReadinessState, ReviewState } from "./types";

/** A normalized check (GitHub CheckRun or legacy StatusContext). */
export interface CheckSignal {
  name: string;
  state: "success" | "failure" | "pending" | "neutral";
}

/** Raw readiness facts for one PR, already normalized by the GitHub layer. */
export interface RawReadiness {
  number: number;
  headSha?: string;
  isDraft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  checks: CheckSignal[];
}

/** Default-branch rules that affect readiness (from the rulesets API; may be partial). */
export interface BranchRules {
  requiredChecks: string[];
  requiredApprovals: number;
  mergeQueue: boolean;
  /** False when classic branch protection could not be read (needs admin) — rules may be partial. */
  complete: boolean;
}

export const EMPTY_RULES: BranchRules = { requiredChecks: [], requiredApprovals: 0, mergeQueue: false, complete: false };

const uniqSorted = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));

/**
 * Collapse CI, reviews, mergeability, draft state and branch rules into one readiness verdict.
 * Pure and deterministic. READY = mergeable now; WAITING = nothing wrong, something pending;
 * NOT_READY = something must change (draft, failing CI, changes requested, conflicts with base).
 */
export function toReadiness(raw: RawReadiness, rules: BranchRules = EMPTY_RULES): Readiness {
  const failingChecks = uniqSorted(raw.checks.filter((c) => c.state === "failure").map((c) => c.name));
  const pendingChecks = uniqSorted(raw.checks.filter((c) => c.state === "pending").map((c) => c.name));
  const present = new Set(raw.checks.map((c) => c.name));
  const missingRequiredChecks = uniqSorted(rules.requiredChecks.filter((c) => !present.has(c)));

  const ci: CiState = failingChecks.length
    ? "failure"
    : pendingChecks.length || missingRequiredChecks.length
      ? "pending"
      : raw.checks.length
        ? "success"
        : "none";

  const review: ReviewState =
    raw.reviewDecision === "APPROVED"
      ? "approved"
      : raw.reviewDecision === "CHANGES_REQUESTED"
        ? "changes_requested"
        : raw.reviewDecision === "REVIEW_REQUIRED"
          ? "review_required"
          : "none";

  const mergeable = raw.mergeable === "MERGEABLE" ? "clean" : raw.mergeable === "CONFLICTING" ? "conflicting" : "unknown";

  const reasons: string[] = [];
  if (raw.isDraft) reasons.push("Draft PR");
  if (failingChecks.length) reasons.push(`CI failing: ${failingChecks.slice(0, 3).join(", ")}${failingChecks.length > 3 ? "…" : ""}`);
  if (review === "changes_requested") reasons.push("Changes requested");
  if (mergeable === "conflicting") reasons.push("Conflicts with the base branch");
  if (pendingChecks.length) reasons.push(`CI running: ${pendingChecks.slice(0, 3).join(", ")}${pendingChecks.length > 3 ? "…" : ""}`);
  if (missingRequiredChecks.length) reasons.push(`Required check not reported: ${missingRequiredChecks.join(", ")}`);
  if (review === "review_required") reasons.push("Review required");

  const state: ReadinessState =
    raw.isDraft || failingChecks.length || review === "changes_requested" || mergeable === "conflicting"
      ? "NOT_READY"
      : pendingChecks.length || missingRequiredChecks.length || review === "review_required"
        ? "WAITING"
        : "READY";

  let score = 100;
  if (raw.isDraft) score -= 60;
  if (failingChecks.length) score -= 40;
  if (review === "changes_requested") score -= 30;
  if (mergeable === "conflicting") score -= 30;
  if (pendingChecks.length) score -= 15;
  if (review === "review_required") score -= 20;
  score -= Math.min(20, missingRequiredChecks.length * 10);
  if (mergeable === "unknown") score -= 5;

  return {
    ci,
    failingChecks,
    pendingChecks,
    review,
    mergeable,
    draft: raw.isDraft,
    missingRequiredChecks,
    state,
    score: Math.max(0, Math.min(100, score)),
    reasons,
  };
}
