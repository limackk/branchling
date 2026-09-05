---
id: TL-276
title: "A red-on-purpose suite gives the next hand no way to tell whose failure it is"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
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
  - id: known-red-declared
    bash: "node --test scripts/tests/known-red.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A hand that inherits a tree with deliberately failing tests can tell which
of them are its business. Today it cannot, and two hands answered the
question by swapping a production file out and back — one of them a single
command away from committing the wrong version.

## Context

The two-hand pipeline commits red on purpose: the `spec` hand's whole
deliverable is a failing test. Every contract in this repository carrying
`node --test scripts/tests/*.test.mjs` then reads that red as its own.
TL-242 covers what that does to the DISPATCHER — a finished task parked for
somebody else's failure. This task is about what it does to the HAND.

Measured twice, in different waves:

    A red suite committed on purpose makes the DEV hand's own gate
    unreadable: "green" is no longer available as an answer, and the only
    way to tell my 5 from someone else's 5 was to stage a revert.
      $ cp scripts/regen-hook.mjs <scratchpad> && git checkout HEAD -- …
      ℹ fail 5     # the same five
      $ cp <scratchpad>/regen-hook.mjs.mine scripts/regen-hook.mjs
    Swapping a production file out and back to establish a baseline is
    exactly the manoeuvre the "do not weaken somebody else's proof" rule is
    trying to make unnecessary, and I was one `cp` away from committing the
    HEAD version by accident.

    The ban on `git stash` (shared stack across worktrees) ruled out the
    standard way. The only comparison left without a stash and without a
    new worktree is replacing files by hand:
      $ cp scripts/history.mjs $SP/history.new.mjs
      $ git show HEAD:scripts/history.mjs > scripts/history.mjs
      $ node --test … ; cp $SP/history.new.mjs scripts/history.mjs
    It works, but the working tree is in a mixed state for a moment — if the
    test had killed the process, production would have been left replaced.

Both hands said the same thing in their own words: there is no
`--expect-failures` and no known-red list, so the runner has no vocabulary
for a state the workflow deliberately creates.

**What the tool already knows.** The history says which task each red test
belongs to: the `spec` hand's commit carries the task id in its title, and
`git log -- <test file>` answers in one call. A declared list is not the
only design — deriving it is possible — but something has to hold the
answer.

**Why `git stash` is not the fallback.** CLAUDE.md forbids it: the stash
stack is shared across every worktree on this clone, so a hand that
stashes may pop somebody else's work. The workaround both hands reached for
instead is more dangerous than the thing that was forbidden.

## Steps

1. Decide where the answer lives: a `known_red:` list in `config.yaml`
   naming test files and the task that made them red; derived from the
   history at run time; or a flag on the contract entry. Record with
   `branchling decide`.
2. Give the hand one call that answers "is this failure mine": something
   like `branchling check --red-owners`, printing each failing test with
   the task that last touched it.
3. Say in the autonomous-loop guide that a two-hand pipeline commits red on
   purpose and how a hand asks whose it is — the guide does not mention
   roles at all today (TL-263).
4. Do NOT make the suite skip a known-red test. A test that stops running
   stops proving; the answer is attribution, not suppression.

## Acceptance criteria

- [ ] A hand can ask, in one command, which failing tests belong to another
      task, proven by a test that fails against today's code.
      [proof: known-red-declared]
- [ ] No test is skipped or silenced by the mechanism. [proof: suite-green]
