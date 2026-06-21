import { z } from "zod";

/**
 * AI semantic-conflict layer types (plan §14). The LLM output is ALWAYS validated against this
 * Zod schema before use — malformed output is treated as a failure and falls back to the heuristic.
 */
export const VerdictSchema = z.object({
  verdict: z.enum(["TRUE_CONFLICT", "CO_LOCATED", "UNCERTAIN"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(600),
});

export type ConflictVerdict = z.infer<typeof VerdictSchema>;

export type VerdictSource = "cache" | "ai" | "heuristic";

export interface ConflictInput {
  prA: number;
  prB: number;
  sharedFiles: string[];
  diffA: string;
  diffB: string;
}
