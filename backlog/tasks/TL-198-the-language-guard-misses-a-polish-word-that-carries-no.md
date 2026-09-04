---
id: TL-198
title: "The language guard misses a Polish word that carries no accent and no known ending"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: ""
role: spec  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-04
blocked_by: [TL-201]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-name                   # optional; a criterion below points at this id
    bash: "command to run"
---

## Goal

`branchling check --language` catches a Polish word that carries an accent, or
that ends the way Polish words usually end. It does not catch one that does
neither. The guard should catch `Tryb`, and the ones like it, or state in its
own text that it cannot — a guard that reports "none matching" over a line that
IS in the wrong language is worse than no guard, because it is read as a pass.

## Context

Found while doing TL-188. The viewer's connection bar had rendered
`Tryb snapshot` to every reader in snapshot mode — the label beside the status
dot, one of the first things anyone sees on a `file://` page. It had survived
TL-137's translation of 145 files and every `check` run since, and
`check --language` was reporting green over the very file it lives in:

    ✓ language: 96307 lines across 418 public files, none matching the accents,
      word lists or Polish word shapes this guard looks for

Measured on 2026-09-03 with a three-line probe in `scripts/`:

    # language-guard: allow — the probe's own input; translating it would
    const x = "Tryb snapshot";     → NOT caught
    # language-guard: allow — falsify the measurement it is evidence of
    const y = "Dodaj zadanie";     → caught (word)
    # language-guard: allow — and the same holds for this one
    const z = "Wersja robocza";    → caught (label)

So the two detectors that fired are the word list and the label heuristic, and
`Tryb` falls between them: four letters, no diacritic, and an ending that is
unremarkable in English too.

<!-- language-guard: allow — the word is QUOTED as the evidence, not written as prose -->
**Why this is not just "add Tryb to the list".** A word list is finite and the
language is not; the next miss will be a different four-letter word. What the
task has to settle is whether the guard's shape can be improved at all —
a frequency list of common Polish stems, a check that flags SHORT unknown tokens
sitting beside known English ones, something else — or whether its reach is
inherently limited, in which case the honest fix is that its GREEN LINE says so.
The present wording ("none matching the accents, word lists or Polish word
shapes this guard looks for") is already nearly that admission; the question is
whether a reader takes it as one.

## Pre-flight reading

1. `scripts/check-public-language.mjs` — the detectors, and the order they run in.
2. `scripts/tests/public-language.test.mjs` — what is currently proven, and on
   what sample.
3. CLAUDE.md, "Language: everything in this repository is English" — which
   three things are enforced by a guard, and which are left to the rule.

## Steps

1. Reproduce the miss as a failing test: a fixture line containing `Tryb`
   (and a couple of other accent-free Polish words) that the guard passes today.
2. Decide between widening the detection and narrowing the CLAIM, and write the
   reasoning into `## Decisions` — this is the part of the task that matters.
3. Implement whichever was chosen. If detection widens, keep a POSITIVE CONTROL:
   an English text that must stay green, so the change cannot be a guard that
   flags everything.
4. Sweep the existing tree once with whatever the new detector is — the same
   gap may be hiding more than one word.

## Decisions

Nothing decided yet. The string itself was corrected in TL-188 (the line was
being edited there anyway); this task is about the guard that let it through.
