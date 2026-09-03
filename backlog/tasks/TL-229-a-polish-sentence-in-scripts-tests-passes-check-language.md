---
id: TL-229
title: "A Polish sentence in scripts/tests passes check --language"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: guard-catches
    bash: "node --test scripts/tests/public-language.test.mjs"
  - id: language-green
    bash: "node scripts/cli.mjs check --language"
---

## Goal

`node scripts/cli.mjs check --language` fails on the Polish fragment standing in
`scripts/tests/new-task.test.mjs:38`, and the fragment is translated. Today the
guard reads that file and reports the whole tree as English.

## Context

Found on 2026-09-03 while working TL-187, which had to read that test.

Line 38 of `scripts/tests/new-task.test.mjs` reads:

    // The patterns come from the tool's own FUNCTIONS, not retyped in the test — a
    // bywa cichym "prawie tym samym" (BL-1452).

The sentence is half-translated: the first line was rendered into English and
the rest of the Polish clause was left standing, so the comment does not parse
in either language.

**The guard covers this file and does not see it.** `PUBLIC_PATHS` in
`scripts/check-public-language.mjs` includes `scripts`, `SKIP_DIRS` excludes
only `node_modules` and `.git`, and the walk reads `.mjs` — so
`scripts/tests/new-task.test.mjs` is inside the perimeter. `check --language`
nonetheless prints a green line counting it among the files it found nothing in.
The words in the fragment carry no accents and are not on the guard's word
lists, and the Polish word shapes it recognises do not match them.

**Why it matters beyond one comment.** CLAUDE.md states the guard as one of the
three things enforced by a machine rather than by the rule alone. A miss on a
sentence this plain says the detector's word list is the whole of its reach —
which means the green line is weaker evidence than it reads as, everywhere.

Note the deliberate carve-out that does NOT apply here: `scripts/tests/` is
outside the PRODUCT NAME guard (a test taking the name from the same constant
asserts `N === N`), and that exemption is about the product name only. Nothing
exempts a test file from the language rule.

## Pre-flight reading

1. `scripts/check-public-language.mjs` — `PUBLIC_PATHS`, `SKIP_DIRS`, and the
   detectors that decide a line is not English.
2. `scripts/tests/public-language.test.mjs` — the existing positive controls,
   and the shape a new one takes.
3. CLAUDE.md, "Language: everything in this repository is English" — the
   perimeter, and the `language-guard: allow` marker for a real exception.

## Steps

1. Add a failing positive control: the fragment above, in a fixture, asserted to
   be CAUGHT. It must fail against today's detectors.
2. Widen the detection so it fires — a wider word list, a shape rule, or another
   signal. Whatever is chosen, run the guard over the whole repository
   afterwards: a rule loose enough to flag English prose is worse than the miss,
   and the false positives are the measurement.
3. Translate the line in `scripts/tests/new-task.test.mjs` so the comment says
   in English what it was trying to say about BL-1452.

## Acceptance criteria

- [ ] The fragment is caught by a positive control that fails against the
      current detectors. [proof: guard-catches]
- [ ] `scripts/tests/new-task.test.mjs` carries no Polish, and the sentence
      reads as one sentence. [proof: language-green]
- [ ] `check --language` stays green over the whole repository — no English line
      is flagged to buy the catch. [proof: language-green]

## Decisions

Nothing decided. Step 2 is deliberately open: whether this is one more word in a
list or a different class of detector is what the work has to establish, and a
mechanism chosen before the false-positive run is a guess.
