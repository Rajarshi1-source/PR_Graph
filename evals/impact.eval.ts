/**
 * Cross-file symbol-impact eval (Feature B). Grades the SHIPPING deterministic detector —
 * `impactLinks` from the pure engine — against hand-labeled PR pairs: does PR A break a definition
 * (remove / rename / re-signature) that PR B newly uses? Offline, deterministic, no network.
 *
 * Flags:
 *   --save-baseline   write the current run to evals/impact-baseline.json
 *   --ci              fail if F1 < MIN_F1 OR regressed > REGRESSION_TOLERANCE vs the baseline
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { impactLinks } from "@/lib/graph/symbols/impact";
import type { PRWithFiles } from "@/lib/graph/types";

const MIN_F1 = 0.75;
const REGRESSION_TOLERANCE = 0.05;

interface Side {
  file: string;
  patch: string;
}
interface Fixture {
  name: string;
  expected: boolean;
  a: Side[];
  b: Side[];
}
interface Baseline {
  f1: number;
  precision: number;
  recall: number;
  accuracy: number;
  n: number;
  generatedAt: string;
}

const args = new Set(process.argv.slice(2));
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "impact-pairs.json"), "utf8")) as Fixture[];
const baselinePath = join(here, "impact-baseline.json");

const toPR = (number: number, sides: Side[]): PRWithFiles => ({
  number,
  title: `PR ${number}`,
  author: "eval",
  createdAt: `2026-01-0${number}T00:00:00Z`,
  htmlUrl: "",
  files: sides.map((s) => ({ filename: s.file, patch: s.patch, additions: 1, deletions: 1, status: "modified" })),
});

let tp = 0;
let fp = 0;
let fn = 0;
let correct = 0;
for (const f of fixtures) {
  const links = impactLinks([toPR(1, f.a), toPR(2, f.b)]);
  const predicted = links.length > 0;
  if (predicted === f.expected) correct++;
  if (predicted && f.expected) tp++;
  else if (predicted && !f.expected) fp++;
  else if (!predicted && f.expected) fn++;
  const detail = links.flatMap((l) => l.symbols.map((s) => `#${l.source}→#${l.target} ${s.change} ${s.name}`)).join(", ");
  console.log(
    `${predicted === f.expected ? "PASS" : "FAIL"}  ${f.name.padEnd(36)} expected=${String(f.expected).padEnd(5)} got=${String(predicted).padEnd(5)} ${detail}`,
  );
}

const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
const accuracy = correct / fixtures.length;

console.log("\n--- SEMANTIC (symbol impact) metrics ---");
console.log(`fixtures : ${fixtures.length}`);
console.log(`accuracy : ${accuracy.toFixed(3)} (${correct}/${fixtures.length})`);
console.log(`precision: ${precision.toFixed(3)}`);
console.log(`recall   : ${recall.toFixed(3)}`);
console.log(`f1       : ${f1.toFixed(3)} (min ${MIN_F1})`);

if (args.has("--save-baseline")) {
  const b: Baseline = { f1, precision, recall, accuracy, n: fixtures.length, generatedAt: new Date().toISOString() };
  writeFileSync(baselinePath, JSON.stringify(b, null, 2) + "\n");
  console.log(`\nBaseline written to ${baselinePath}`);
}

let failed = f1 < MIN_F1;
if (failed) console.error(`\nEval failed: F1 ${f1.toFixed(3)} < ${MIN_F1}`);
if (args.has("--ci") && existsSync(baselinePath)) {
  const prev = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  if (prev.f1 - f1 > REGRESSION_TOLERANCE) {
    console.error(`\nEval regressed: F1 ${f1.toFixed(3)} vs baseline ${prev.f1.toFixed(3)}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("\nEval passed.");
