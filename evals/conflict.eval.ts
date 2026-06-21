/**
 * AI semantic-conflict eval harness (PRGraph_starter_code.md Part 2). Runs the deterministic
 * heuristic against a labeled fixture set and reports precision/recall/F1 for TRUE_CONFLICT.
 * Offline by design (no LLM, no Redis) so it can gate accuracy in CI. When the AI adapter is
 * wired, swap `heuristicVerdict` for `analyzeConflict` here to evaluate the model.
 *
 * Exits non-zero if F1 drops below MIN_F1 — wire this into CI before enabling Phase 2.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { heuristicVerdict } from "@/lib/ai/heuristic";
import type { ConflictInput } from "@/lib/ai/types";

const MIN_F1 = 0.6;

interface Fixture {
  name: string;
  sharedFiles: string[];
  diffA: string;
  diffB: string;
  expected: "TRUE_CONFLICT" | "CO_LOCATED" | "UNCERTAIN";
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "labeled-pairs.json"), "utf8")) as Fixture[];

let tp = 0;
let fp = 0;
let fn = 0;
let correct = 0;

for (const f of fixtures) {
  const input: ConflictInput = {
    prA: 1,
    prB: 2,
    sharedFiles: f.sharedFiles,
    diffA: f.diffA,
    diffB: f.diffB,
  };
  const { verdict } = heuristicVerdict(input);
  const isCorrect = verdict === f.expected;
  if (isCorrect) correct++;

  const predConflict = verdict === "TRUE_CONFLICT";
  const actualConflict = f.expected === "TRUE_CONFLICT";
  if (predConflict && actualConflict) tp++;
  else if (predConflict && !actualConflict) fp++;
  else if (!predConflict && actualConflict) fn++;

  console.log(`${isCorrect ? "PASS" : "FAIL"}  ${f.name.padEnd(28)} expected=${f.expected} got=${verdict}`);
}

const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

console.log("\n--- TRUE_CONFLICT metrics ---");
console.log(`accuracy : ${(correct / fixtures.length).toFixed(3)} (${correct}/${fixtures.length})`);
console.log(`precision: ${precision.toFixed(3)}`);
console.log(`recall   : ${recall.toFixed(3)}`);
console.log(`f1       : ${f1.toFixed(3)} (min ${MIN_F1})`);

if (f1 < MIN_F1) {
  console.error(`\nEval failed: F1 ${f1.toFixed(3)} < ${MIN_F1}`);
  process.exit(1);
}
console.log("\nEval passed.");
