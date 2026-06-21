/**
 * AI semantic-conflict eval harness (PRGraph_eval_connectors.md §3). Grades the **shipping** path —
 * `analyzeConflict` — against a labeled fixture set and reports precision/recall/F1 for
 * TRUE_CONFLICT. With AI_ENABLED=false this measures the deterministic heuristic (what actually
 * ships when AI is off); with AI_ENABLED=true + a key it measures the model.
 *
 * Flags:
 *   --save-baseline   write the current run to evals/baseline.json
 *   --ci              fail if F1 < threshold OR regressed > REGRESSION_TOLERANCE vs baseline
 *
 * Threshold: 0.80 when AI_ENABLED, 0.60 offline-heuristic.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { env } from "@/lib/env";
import { analyzeConflict } from "@/lib/ai/conflictAnalyzer";
import type { ConflictInput } from "@/lib/ai/types";

const REGRESSION_TOLERANCE = 0.05;
const minF1 = env.AI_ENABLED ? 0.8 : 0.6;

const args = new Set(process.argv.slice(2));
const saveBaseline = args.has("--save-baseline");
const ciMode = args.has("--ci");

interface Fixture {
  name: string;
  sharedFiles: string[];
  diffA: string;
  diffB: string;
  expected: "TRUE_CONFLICT" | "CO_LOCATED" | "UNCERTAIN";
}

interface Baseline {
  f1: number;
  precision: number;
  recall: number;
  accuracy: number;
  aiEnabled: boolean;
  generatedAt: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "labeled-pairs.json"), "utf8")) as Fixture[];
const baselinePath = join(here, "baseline.json");

async function main() {
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
    const { verdict, source } = await analyzeConflict(input);
    const isCorrect = verdict === f.expected;
    if (isCorrect) correct++;

    const predConflict = verdict === "TRUE_CONFLICT";
    const actualConflict = f.expected === "TRUE_CONFLICT";
    if (predConflict && actualConflict) tp++;
    else if (predConflict && !actualConflict) fp++;
    else if (!predConflict && actualConflict) fn++;

    console.log(
      `${isCorrect ? "PASS" : "FAIL"}  ${f.name.padEnd(34)} expected=${f.expected.padEnd(13)} got=${verdict.padEnd(13)} [${source}]`,
    );
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = correct / fixtures.length;

  console.log("\n--- TRUE_CONFLICT metrics ---");
  console.log(`mode     : ${env.AI_ENABLED ? "AI" : "heuristic"} (${fixtures.length} fixtures)`);
  console.log(`accuracy : ${accuracy.toFixed(3)} (${correct}/${fixtures.length})`);
  console.log(`precision: ${precision.toFixed(3)}`);
  console.log(`recall   : ${recall.toFixed(3)}`);
  console.log(`f1       : ${f1.toFixed(3)} (min ${minF1})`);

  if (saveBaseline) {
    const baseline: Baseline = {
      f1,
      precision,
      recall,
      accuracy,
      aiEnabled: env.AI_ENABLED,
      generatedAt: new Date().toISOString(),
    };
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`\nBaseline written to ${baselinePath}`);
  }

  let failed = false;
  if (f1 < minF1) {
    console.error(`\nEval failed: F1 ${f1.toFixed(3)} < ${minF1}`);
    failed = true;
  }

  if (ciMode && existsSync(baselinePath)) {
    const prev = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
    const drop = prev.f1 - f1;
    if (drop > REGRESSION_TOLERANCE) {
      console.error(
        `\nEval regressed: F1 ${f1.toFixed(3)} is ${drop.toFixed(3)} below baseline ${prev.f1.toFixed(3)} (tolerance ${REGRESSION_TOLERANCE})`,
      );
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log("\nEval passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
