---
id: TL-226
title: "The language guard counts each signal apart, so one hit in each passes"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: cancelled                  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: combined-evidence
    bash: "node --test scripts/tests/check-public-language.test.mjs"
  - id: tree-clean
    bash: "node scripts/cli.mjs check --language"
---

## Goal

`branchling check --language` fails on
`scripts/tests/new-task.test.mjs:99`, and on any other line that reaches
two Polish signals by carrying one hit of each kind rather than two of
one kind.

## Context

Measured on 2026-09-03 while working on TL-187, which added a test to
that same file. `node scripts/cli.mjs check --language` reports
"105776 lines across 461 public files, none matching" while
`scripts/tests/new-task.test.mjs` line 99 reads, in full:

    // -- Tworzenie taska ------------------------------------------

That is a Polish sentence fragment in a file the guard reads, and the
guard says the tree is clean.

**Why it passes.** `scripts/check-public-language.mjs` runs three
signals over a line and each keeps its own counter:

- `STRONG_WORDS` — one hit is enough. Neither word is on that list.
- `STOP_WORDS` — two hits on the line. `taska` is on the list; that is
  one.
- `polishShapeHits()` — two hits on the line. `Tworzenie` carries the
  digraph `rz`; that is one.

Two independent pieces of evidence stand on the line and neither
counter reaches its own threshold, so the line is reported as English.
The thresholds are right individually — the file argues for each of
them at length, and those arguments still hold. What is missing is that
nothing adds them up.

This is not the blindness the file already documents. The comment above
`POLISH_DIGRAPH` concedes that a short phrase with no accent, no
digraph and no ending gets through, and offers `STRONG_WORDS` as the
last resort. This case is the opposite: the evidence IS there, in two
places, and the arithmetic discards it.

**Why it matters more than one comment.** The whole reason TL-129 added
the shape signal was that a green line saying "N files read as English"
gets cited as proof, and the citation was false. It is false again, for
a different reason, and the same file says so about itself.

## Pre-flight reading

1. `scripts/check-public-language.mjs` — `STRONG_WORDS`, `STOP_WORDS`,
   `polishShapeHits()`, `labelHits()` and the loop around line 302 that
   applies the three thresholds one after another.
2. `scripts/tests/check-public-language.test.mjs` — where the
   thresholds are pinned, and where a combined-evidence case has to go.
3. The comment blocks above each list. Each threshold has a stated
   reason; a change that raises the false-positive rate has to answer
   them rather than ignore them.

## Steps

1. Write the failing case first: a line carrying exactly one stop word
   and one Polish-shaped word is reported.
2. Decide how the evidence combines — a shared score across signals
   with the current thresholds preserved as special cases is the
   obvious shape, but the decision belongs in this task, not here.
3. Establish the false-positive cost on the real tree: the guard has to
   stay silent on 461 files that are English today. A change that
   turns real files red has not been measured until that run is green.
4. Fix `scripts/tests/new-task.test.mjs` lines 38 and 99, which the
   working guard will then name. Line 38 is a Polish sentence with no
   signal at all and may need `STRONG_WORDS` or simply rewriting.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool
ticks it after a green run.

- [ ] A line with one stop-word hit and one Polish-shape hit is
      reported. [proof: combined-evidence]
- [ ] The guard is silent on this repository's public files.
      [proof: tree-clean]
