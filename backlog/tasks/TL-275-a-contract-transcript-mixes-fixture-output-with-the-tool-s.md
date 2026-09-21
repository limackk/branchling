---
id: TL-275
title: "A contract transcript mixes fixture output with the tool's own failures"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: fixture-output-marked
    bash: "node --test scripts/tests/refusal-transcript.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

When `done` refuses, what the reader sees as a failure IS a failure. Today
the transcript carries the output of tests that assert a guard fails, and
that output is this tool refusing — same glyph, same wording — so the
reader is shown failures the tool invented on purpose.

## Context

Two hands lost time to this independently, in different waves, neither
having seen the other.

The first, closing TL-214:

    `branchling done` dumped ~700 lines of test output to say "4 red". The
    refusal pasted the whole list, including positive-control output —
    `✗ backlog: task identity is violated`, `BL-262`,
    `BL-900-feeding-dialog.md` — which looks like a failure and is a test
    fixture. Finding the four real ✖ meant searching that wall.

The second, on TL-151, six waves later:

    The refusal transcript was misleading in two ways. It was truncated
    before the eight actual failures, so the only ✗ lines visible were the
    guard's own output, captured by tests that assert the guard fails.
    branchling's `✗` is the same glyph `node --test` uses. Reading the
    transcript alone, the natural conclusion is that the id-collision guard
    is broken against a foreign backlog. It is fine. I had to re-run the
    suite myself to find that out.

Both reached the same wrong conclusion from the same cause and both spent a
full extra suite run — between 80 seconds and ten minutes here — correcting
it.

**The cause is that two things share one alphabet.** `scripts/ui.mjs` prints
`✗` for a refusal. `node --test` prints `✖` for a failing test. A test that
runs the CLI and asserts it refuses captures the first and prints it inside
the second's stream. Nothing in the transcript says which layer a line came
from, and the ids in the fixtures (`BL-262`, `TASK-1`) are the only clue
that a line is not about this repository.

**Why it is worse in a refusal than in a terminal.** A person running the
suite has the tree in front of them. `done`'s refusal is read by an agent
that has only the transcript, and the loop feeds that transcript to the
NEXT attempt as the reason the last one failed. A wrong diagnosis is
therefore inherited rather than corrected.

**Not TL-221.** That task stopped `done` printing the output of entries
that PASSED, and is closed. This is about the output of the entries that
fail, and about output that is not a failure at all.

## Steps

1. Decide the mechanism. The candidates: a fixture that runs this CLI marks
   its captured output (a prefix, an env var the tests set that changes the
   glyph); the refusal re-emits only lines the test runner attributes to a
   failure; the tests capture rather than print. Record with `branchling
   decide` — the first is cheap and the third is the honest one.
2. Whatever is chosen, a refusal transcript must let a reader say, per
   line, whether it came from the tool under test or from the tool being
   run by a test.
3. Check the truncation while here: the second report says the transcript
   was cut BEFORE the real failures, which makes the mechanism above
   necessary but not sufficient.

## Acceptance criteria

- [x] Output the suite captured from a nested CLI run is distinguishable
      from a real failure in a refusal transcript, proven by a test that
      fails against today's output. [proof: fixture-output-marked]
- [x] A genuine refusal still reads as one. [proof: suite-green]
