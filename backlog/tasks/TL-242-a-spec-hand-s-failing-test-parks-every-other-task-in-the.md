---
id: TL-242
title: "A spec hand's failing test parks every other task in the wave"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: pending  # pending | in_progress | blocked | done | cancelled
owner: agent:codex-dispatch
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: a-neighbours-red-does-not-park-me
    bash: "node --test scripts/tests/contract-scope.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

A task is parked for ITS OWN failure. Today a contract entry that runs the whole
suite fails on a red test belonging to a different task, so a finished piece of
work is filed as failed because somebody else's proof has not been satisfied yet.

## Context

Measured on 2026-09-04, wave 7, two-hand pipeline.

The `spec` hand's entire job is to leave a FAILING test in the tree: it writes
the proof that a defect is real and hands the task on. In this wave it did that
for TL-201, committing `4db2bc6` — two red cases in
`scripts/tests/public-language.test.mjs`.

The `dev` stage then took TL-202 first. TL-202's own change was correct and its
own tests passed; its contract also carries

```
- id: suite-green
  bash: "node --test scripts/tests/*.test.mjs"
```

which is the WHOLE suite, TL-201's deliberate red included. Two attempts, both
refused, and the task was parked:

```
! TL-202  exhausted  2 attempts  1231s
    suite-green: node --test scripts/tests/*.test.mjs
reason: no verification after 2 agent attempts: suite-green: …
```

Then TL-201's dev hand landed `54d972c`, the suite went green, and TL-201
closed. TL-202 stayed `blocked`. Re-running its contract afterwards passes every
entry, so the tree was recording a defeat that never happened, and `next` would
have handed the same finished work out again.

This is not a defect of the pipeline and not of the contract. It is what the two
meet as: nearly every task in this backlog asserts the whole suite, and a
pipeline whose first stage is a red test makes that assertion false for every
neighbour until the second stage lands.

## Steps

1. Decide the question below and record it before touching code.
2. Whatever is decided, the RUN must be able to tell "my own entry failed" from
   "somebody else's red is in my suite" — the reason it writes today names the
   command and blames the attempt count, which is the TL-193 defect in a new
   place.
3. `scripts/tests/contract-scope.test.mjs`: a task whose own entries pass is not
   parked while a foreign test is red. The positive control is a task whose OWN
   entry fails, which must still be parked.

## Acceptance criteria

- [ ] A suite failure already present when the task is claimed is classified apart
  from a failure introduced by that task. [proof: a-neighbours-red-does-not-park-me]
- [ ] When the task's own entry passes and only the baseline failure remains, the
  run reports that fact, makes no second attempt, and leaves the task claimed
  rather than parking or releasing it. [proof: a-neighbours-red-does-not-park-me]
- [ ] When the hand introduces a failure in the task's own entry, the run still
  exhausts the configured attempts and parks the task with a reason naming that
  entry. [proof: a-neighbours-red-does-not-park-me]
- [ ] The complete automated test suite remains green after the implementation.
  [proof: suite-green]
- [ ] The repository consistency guards remain green after the implementation.
  [proof: guards-green]

## Open question

**What does a run do when a contract's suite entry is red for a foreign reason?**

1. *(recommended)* The run compares the failure against the tree it took the
   task from: a test that was ALREADY red before the agent started is not this
   task's failure, and the task is parked — if at all — with a reason that says
   so. Cheap, needs no new vocabulary, and it is a fact the loop can measure
   rather than a rule somebody has to follow.
2. A task's contract may not assert the whole suite; entries name their own
   tests. Honest, and it costs every task in this backlog a rewrite, plus it
   removes the one check that catches a change breaking something far away.
3. The pipeline's stages run in isolated trees. Correct in principle and it
   makes the second hand unable to see the first hand's test, which is the whole
   point of the split.

## Decisions

**The run compares a red contract entry with its state at claim time.** A
failure already present before the agent starts is foreign to this task: it is
reported as such and must not consume the task's failure budget or park it.
This preserves whole-suite contracts without adding a task-specific vocabulary;
the loop can measure the distinction from its own baseline. A newly introduced
or still-present failure that was not in that baseline remains this task's
failure and is parked after the configured attempts.

**"Run spec and dev per task, alternating" was dismissed here too quickly.**
This task first said it "only shrinks the window". Measured afterwards, it
closes it: at the moment a dev hand's `done` runs, the only red test in the tree
is the one that hand has just satisfied, because no other task's spec stage has
started. It is not a fix — it is a way of working around the defect, it doubles
the number of runs, and it is what wave 8 was driven with. The fix below still
needs doing, because the workaround depends on whoever launches the run
remembering it.
