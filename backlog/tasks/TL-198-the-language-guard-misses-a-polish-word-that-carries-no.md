---
id: TL-198
title: "The language guard misses a Polish word that carries no accent and no known ending"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:dev
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-04
blocked_by: [TL-201]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: reach
    bash: "node --test scripts/tests/language-guard-reach.test.mjs"
  - id: guard-green
    bash: "node scripts/cli.mjs check --language"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
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

The string itself was corrected in TL-188 (the line was being edited there
anyway); this task is about the guard that let it through.

**The choice offered in Step 2 — widen the detection or narrow the claim — was
settled for the WORD half by TL-201, which this task was blocked on.** The
dictionary inverts the question: a word this project has never written is
unknown, and an unknown word fails. `Tryb` is caught today, and so are `Wybor`,
`Kolejno` and `Naglowek`; TL-201's own test file carries that positive control.
Detection was widened, and by construction rather than by one more entry in a
list, so the claim did not have to be narrowed.

**What TL-201 could not close is the FILE half, and that is what is left of this
task.** A word is only judged on a line somebody opened. `walk()` in
`scripts/check-public-language.mjs` collects `.mjs`, `.js` and `.md` and nothing
else, so `backlog/config.yaml`, `backlog/plan.yaml` and `backlog/boards.yaml`
are never opened — while the header of that same file states they are covered
"as a side effect of adding the directory", and CLAUDE.md says the guard reads
"the whole `backlog/` directory". Measured 2026-09-04: a tree whose only public
file is a `backlog/config.yaml` carrying a Polish label audits as 0 files, 0
lines, 0 findings, and 0 findings is what the tick is printed over. That is this
task's own thesis one layer down — a green line read as a pass over text that IS
in the wrong language — and `config.yaml` is the worst place for it, because
under law 3 that file holds the project's vocabulary: the status names, the
labels, the board titles a stranger reads before any comment in `scripts/`.

**Not "every YAML file under `backlog/`".** `NOW.yaml`, `INDEX.yaml`,
`archive/done.yaml` and `boards/` are computed views, deletable by law 2. A
guard that reads generated output fails on output rather than on a decision
somebody took, and it would report a stale finding from the last `build`. The
three source files the guard already claims are the perimeter.

**Not TL-229 and not TL-128.** Those are the untranslated Polish standing in
`scripts/tests/`, which the walk DOES open — a translation debt behind a
detector that misses it. This is the inverse: text in the right shape for the
detectors, in a file the walk never reaches.

**The failing test is `scripts/tests/language-guard-reach.test.mjs`.** It asserts
a Polish label in each of the three files is reported, and that the
`language-guard: allow` marker still expresses an exception in a file the guard
has only just started reading — that last one asserts a COUNT of one, because a
walk that opens nothing answers zero and would satisfy any assertion about
silence. Two controls stand beside them: a Polish task file in the same
throwaway root IS caught today (the harness proves something), and an ordinary
English configuration file must stay silent (the widening may not become a guard
that flags the file it was pointed at).

**A cost the implementing hand will meet.** `backlog/plan.yaml` is English but
carries six words the dictionary has never seen — `arranges`, `believable`,
`tenths`, `thirds`, `poison`, `restarted`. They are added to
`scripts/language-dictionary.txt` by hand, which is the procedure the guard
prints for exactly this case.
