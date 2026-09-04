---
id: TL-206
title: "run --plan and run --plan --dry-run disagree about the same queue"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:dev
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: agree
    bash: "node --test scripts/tests/plan-dry-run-agrees.test.mjs"
---

## Goal

`run --plan --dry-run` and `run --plan` must describe the same queue. Today one
lists twenty-two tasks and the other takes none, in the same tree, one second
apart.

## Context

Measured on 2026-09-03, immediately after wave 3 was added to the plan:

    $ branchling run --plan --dry-run
      22 task(s) would run, in this order:
        wave 3 — A question a person can answer in a minute
          · TL-204  P1  ask carries options, and names the one it recommends
        …

    $ branchling run --plan --agent "…" --max-tasks 2
      0 task(s) taken · 0 closed · 0 blocked · 0s
      · nothing was taken
      stopped: the queue is empty

**The cause is a wave that only a person can finish.** Wave 2 held one open
task, TL-122, marked `executor: human`. `next --plan` takes the earliest wave
holding an open task, finds only work it may not be handed, and answers exit 3
— which the loop prints as an empty queue. `--dry-run` walks the plan
differently and lists every later wave.

**Which of the two is right is a real question and must be decided, not
patched.** A wave is an ORDER: letting the fleet run ahead into wave 3 while
wave 2 waits on a person weakens what a wave means. Refusing to run leaves the
fleet idle behind one human task — here, indefinitely, because nobody has
answered TL-122 in a day. Both readings are defensible, which is exactly the
case `ask` exists for; whoever takes this should ASK rather than choose
silently, and once TL-204 lands, ask with options.

**It is not TL-186 and not TL-199, and all three touch the same sentence.**
TL-186 is about `stopped: the queue is empty` being false when the plan is
merely waiting — the same message, a different cause, and fixing it would make
this run SAY something true while still doing nothing. TL-199 is the plan
view's twin: a wave waiting on a person reads as a wave waiting on work. This
one is narrower and harder: two code paths answer the same question
differently, so at least one of them is wrong about the plan itself.

**Why a divergence between a dry run and a run is worse than either
behaviour.** `--dry-run` exists to be trusted before an unattended run is
started. An operator who checks first and then launches gets a report that
contradicts what they were shown, and nothing in either output says they
disagree.

## Pre-flight reading

1. `scripts/run-loop.mjs` — the `--dry-run` path and the live path, and where
   each one consults the plan.
2. `scripts/next-task.mjs` — the `--plan` filter added by TL-183: which wave it
   selects and what it does when that wave holds only tasks it may not hand out.
3. `scripts/plan.mjs` — `validatePlan` and the wave model; in particular that a
   wave is a batch and the plan is advisory.
4. `backlog/tasks/TL-186-*.md` and `TL-199-*.md` — the two neighbours, so the
   fix does not silently absorb either.

## Steps

1. Reproduce in a fixture: two waves, the earlier one holding a single open
   `executor: human` task, and assert that the two paths agree.
2. Ask the question — may the fleet run ahead of a wave only a person can
   finish — and record the answer in Decisions before implementing.
3. Make both paths read the plan through one function, so a future divergence
   is impossible rather than merely fixed.
4. Whatever the answer, the report must NAME the human-held wave rather than
   calling the queue empty.

## Decisions

Nothing decided. Note that the two neighbours must stay separately closable:
this task is about the two paths agreeing, not about the wording they agree on.
