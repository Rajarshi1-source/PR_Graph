# Eval data

| File | Graded by | What it is |
|---|---|---|
| `labeled-pairs.json` | `conflict.eval.ts` (`npm run eval`) | 36 hand-written PR pairs for the semantic-conflict analyzer |
| `impact-pairs.json` | `impact.eval.ts` (`npm run eval:impact`) | 22 hand-written cross-file symbol-impact cases, one behaviour each |
| `impact-real-pairs.json` | `impact.eval.ts` | 111 commit pairs from real public repositories (below) |

## `impact-real-pairs.json`

Each fixture is a pair of real commits from the same repository, treated as if both were open PRs
at once. The label answers one question: **would merging A break code that B adds (or the reverse)
because a definition one side uses was removed, renamed, re-signatured or made less visible?** The
concurrency is hypothetical; the diffs are real. A pair counts as positive only when the break
would really happen: a new optional parameter, a widened type, a method moved to a base class, or
a same-named method on another type is labelled negative.

Every label was assigned by reading both diffs, with a one-line `note` explaining it, and
`source.repo` / `source.a` / `source.b` give the commits so any label can be re-checked:

```bash
git -C <clone> show <source.a>
```

### How pairs were chosen

| `origin` | How it was found | Purpose |
|---|---|---|
| `detector-sample` | The pre-revision detector was run over ~1,500 commits of each repo; for every commit with a breaking definition change it found the nearest earlier commit that added a reference to that name. Pairs were then sampled **evenly** across each repo's candidate list, not cherry-picked. | Precision on what the detector actually flags |
| `history-mined` | Commits whose message says they rename or remove an API, paired with an earlier commit that adds a use of the old name, plus homonym look-alikes. Found without the detector. | Recall on breaks the detector did not choose |
| `adjacent-commits` | Consecutive commits at fixed offsets in each history. | The background false-positive rate on unrelated work |

### Splits

- **`dev` (62)** was used while revising the detector: every rule it gained (parameter
  compatibility, visibility and reach, comment/prose filtering, member access, moves) came from
  reading these failures.
- **`holdout` (49)** was sampled and labelled *after* those rules were written, from different
  positions in the same candidate lists and histories, and was not tuned on. Quote holdout numbers.

Two sampled pairs were dropped from the holdout before scoring: one duplicated a dev pair, and one
could not be labelled confidently because the commits came from different eras of the code.

### Size limits

Only files in languages the detector reads are kept. A patch over 8 KB keeps its leading hunks, and
each side is capped at 32 KB. Every positive was re-checked after clipping and still contains both
the definition change and the use.

### Sources and licences

The patches are excerpts from these repositories, used under their licences:

| Repository | Licence |
|---|---|
| [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | MIT / Unlicense |
| [google/gson](https://github.com/google/gson) | Apache-2.0 |
| [pallets/flask](https://github.com/pallets/flask) | BSD-3-Clause |
| [psf/requests](https://github.com/psf/requests) | Apache-2.0 |
| [rack/rack](https://github.com/rack/rack) | MIT |
| [sindresorhus/ky](https://github.com/sindresorhus/ky) | MIT |
| [spf13/cobra](https://github.com/spf13/cobra) | Apache-2.0 |
| [vercel/swr](https://github.com/vercel/swr) | MIT |

### Known limits of the set

- 21 positives in all (12 dev, 9 holdout), so one fixture moves recall by 5–11 points.
- TypeScript, Python, Go, Java, Rust and Ruby are covered; C#, Kotlin and PHP are not.
- Labels are one reviewer's reading of the diffs. A wrong label is a bug: fix it in the file and say
  why in its `note`.
