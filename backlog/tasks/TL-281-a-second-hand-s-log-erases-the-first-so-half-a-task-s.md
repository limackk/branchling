---
id: TL-281
title: "A second hand's log erases the first, so half a task's transcript is lost"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: both-legs-kept
    bash: "node --test scripts/tests/run-follows-handoff.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Every hand that worked a task leaves a transcript a reader can still find.
Today the second hand's run erases the first's, and the report points both
legs at the one surviving file.

## Context

A regression from TL-271, measured on 2026-09-05 the first time the fixed
loop ran a full pipeline — TL-91, `spec` then `dev`, one run:

    ✓ TL-91  handed-on  1 attempt  633s
        …/w13a-logs/TL-91.log
    ✓ TL-91  closed     1 attempt  1073s
        …/w13a-logs/TL-91.log

Two legs, one path. `logPathFor` keys the file on the task id alone, and
`workOne` opens each attempt with

    writeFileSync(logPath, "", "utf8");

so the `dev` leg truncated the `spec` leg's output before writing its own.
The surviving file is 13 lines: the dev hand's friction log, which opens
"a supplement to the previous one" and refers to a transcript that no
longer exists. Ten minutes of the spec hand's reasoning, its commands and
its own friction section are gone.

**Before TL-271 this could not happen**, because a task was worked by one
hand per run: the truncation was how a RETRY started clean, and there was
never a second role writing to the same name. Following a handoff made the
file's key too coarse without anything saying so.

**Why this is P1 and not cosmetic.** The friction sections in those logs
are the only record of what the tool did to the hands working it; eight
tasks in this backlog were filed from them, and TL-269 exists to harvest
them automatically. A mechanism that loses half of them by construction
takes the evidence out of the loop that TL-269 is meant to close. It also
makes the report lie in a small, quiet way: it prints a path for the first
leg that no longer holds that leg's output.

**Not TL-269.** That task collects the marked sections; this one is about
the file they live in being overwritten before anything can collect them.

## Steps

1. Key the log on the leg, not only on the task: the role and the sequence
   are both already in hand at the call site. `TL-91.log` for a single-hand
   task should stay as it is, so a reader of one-hand runs sees no change.
2. Report the path each leg actually wrote, not the shared name.
3. Decide with `branchling decide` whether the truncation stays per LEG (an
   attempt's retry still starts clean, which is what it was for) or whether
   a run should append across legs into one file with a separator. The
   first keeps the existing meaning; the second keeps a task's transcript
   in one place.

## Acceptance criteria

- [x] A task worked by two hands in one run leaves both transcripts
      readable afterwards, proven by a test that fails against today's
      loop. [proof: both-legs-kept]
- [x] The report's per-leg path names the file that leg wrote.
      [proof: both-legs-kept]
- [x] A single-hand run is unchanged, path included. [proof: suite-green]
