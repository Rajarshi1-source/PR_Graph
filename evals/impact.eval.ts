/**
 * Cross-file symbol-impact eval (Feature B). Grades the SHIPPING deterministic detector —
 * `impactLinks` from the pure engine — on two sets:
 *
 *   synthetic  evals/impact-pairs.json       hand-written cases, one behaviour each (written with
 *                                            the detector, so they guard behaviour — not quality)
 *   real       evals/impact-real-pairs.json  real commit pairs from public repositories, labelled by
 *                                            reading the diffs (see evals/README.md for provenance).
 *                                            `dev` pairs were used while tuning the detector;
 *                                            `holdout` pairs were labelled first and not tuned on.
 *
 * Does PR A break a definition (remove / rename / re-signature) that PR B newly uses? Offline,
 * deterministic, no network.
 *
 * Flags:
 *   --save-baseline   write the current run to evals/impact-baseline.json
 *   --ci              fail if a set's F1 < its floor OR regressed > REGRESSION_TOLERANCE vs baseline
 *   --verbose         print every fixture (default prints only failures for the real set)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { impactLinks } from "@/lib/graph/symbols/impact";
import type { PRWithFiles } from "@/lib/graph/types";

/** Minimum F1 per set. Real-set floors sit below the values measured when the sets were added. */
const MIN_F1: Record<SetName, number> = { synthetic: 0.75, "real-dev": 0.5, "real-holdout": 0.5 };
const REGRESSION_TOLERANCE = 0.05;

type SetName = "synthetic" | "real-dev" | "real-holdout";
interface Side {
  file: string;
  patch: string;
}
interface Fixture {
  name: string;
  expected: boolean;
  a: Side[];
  b: Side[];
  split?: "dev" | "holdout";
  origin?: string;
  note?: string;
}
interface Metrics {
  f1: number;
  precision: number;
  recall: number;
  accuracy: number;
  n: number;
  positives: number;
}
interface Baseline extends Partial<Metrics> {
  sets?: Partial<Record<SetName, Metrics>>;
  generatedAt: string;
}

const args = new Set(process.argv.slice(2));
const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, f), "utf8")) as Fixture[];
const real = load("impact-real-pairs.json");
const sets: Record<SetName, Fixture[]> = {
  synthetic: load("impact-pairs.json"),
  "real-dev": real.filter((f) => f.split !== "holdout"),
  "real-holdout": real.filter((f) => f.split === "holdout"),
};
const baselinePath = join(here, "impact-baseline.json");

const toPR = (number: number, sides: Side[]): PRWithFiles => ({
  number,
  title: `PR ${number}`,
  author: "eval",
  createdAt: `2026-01-0${number}T00:00:00Z`,
  htmlUrl: "",
  files: sides.map((s) => ({ filename: s.file, patch: s.patch, additions: 1, deletions: 1, status: "modified" })),
});

function grade(name: SetName, fixtures: Fixture[]): Metrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let correct = 0;
  const byOrigin = new Map<string, { n: number; correct: number }>();
  console.log(`\n=== ${name} (${fixtures.length}) ===`);
  for (const f of fixtures) {
    const links = impactLinks([toPR(1, f.a), toPR(2, f.b)]);
    const predicted = links.length > 0;
    const ok = predicted === f.expected;
    if (ok) correct++;
    if (predicted && f.expected) tp++;
    else if (predicted && !f.expected) fp++;
    else if (!predicted && f.expected) fn++;
    const o = byOrigin.get(f.origin ?? name) ?? { n: 0, correct: 0 };
    o.n++;
    if (ok) o.correct++;
    byOrigin.set(f.origin ?? name, o);
    if (ok && name !== "synthetic" && !args.has("--verbose")) continue;
    const detail = links.flatMap((l) => l.symbols.map((s) => `${s.change} ${s.name}`)).join(", ");
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${f.name.padEnd(44)} expected=${String(f.expected).padEnd(5)} got=${String(predicted).padEnd(5)} ${detail}`,
    );
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const m = { f1, precision, recall, accuracy: correct / fixtures.length, n: fixtures.length, positives: tp + fn };
  console.log(`--- ${name}: symbol-impact metrics ---`);
  console.log(`fixtures : ${m.n} (${m.positives} positive)`);
  console.log(`accuracy : ${m.accuracy.toFixed(3)} (${correct}/${m.n})`);
  console.log(`precision: ${precision.toFixed(3)}  (tp ${tp}, fp ${fp})`);
  console.log(`recall   : ${recall.toFixed(3)}  (fn ${fn})`);
  console.log(`f1       : ${f1.toFixed(3)} (min ${MIN_F1[name]})`);
  if (byOrigin.size > 1) {
    for (const [o, v] of byOrigin) console.log(`  ${o.padEnd(18)} ${v.correct}/${v.n} correct`);
  }
  return m;
}

const results = Object.fromEntries(
  (Object.keys(sets) as SetName[]).map((name) => [name, grade(name, sets[name])]),
) as Record<SetName, Metrics>;

if (args.has("--save-baseline")) {
  const b: Baseline = { sets: results, generatedAt: new Date().toISOString() };
  writeFileSync(baselinePath, JSON.stringify(b, null, 2) + "\n");
  console.log(`\nBaseline written to ${baselinePath}`);
}

let failed = false;
const prev: Baseline | null = existsSync(baselinePath)
  ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline)
  : null;
for (const name of Object.keys(results) as SetName[]) {
  const m = results[name];
  if (m.f1 < MIN_F1[name]) {
    console.error(`\nEval failed: ${name} F1 ${m.f1.toFixed(3)} < ${MIN_F1[name]}`);
    failed = true;
  }
  // Older baselines stored only the synthetic set at the top level.
  const before = prev?.sets?.[name]?.f1 ?? (name === "synthetic" ? prev?.f1 : undefined);
  if (args.has("--ci") && before !== undefined && before - m.f1 > REGRESSION_TOLERANCE) {
    console.error(`\nEval regressed: ${name} F1 ${m.f1.toFixed(3)} vs baseline ${before.toFixed(3)}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("\nEval passed.");
