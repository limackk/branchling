---
id: TL-257
title: "plan and run --plan disagree about the order inside one wave"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: orders-agree
    bash: "node --test scripts/tests/plan-order-within-wave.test.mjs"
---

## Goal

A person reading `branchling plan` sees the order the fleet will actually
work in. Today the two commands read the same `plan.yaml` and answer with
two different sequences, and neither says the other exists.

## Context

Measured on 2026-09-04 in a clean tree, one second apart, wave 9 active:

    $ branchling plan
      next up (wave 9 - Premises that went stale):
        TL-143
        TL-144
        TL-128

    $ branchling run --plan --dry-run --agent-for docs=...
      3 task(s) would run, in this order:
        wave 9 - Premises that went stale
          - TL-128  P3  Polish assertion messages in scripts/tests/ ...
          - TL-143  P3  TL-121's premise is stale ...
          - TL-144  P3  TL-112's steps write to a docs path ...

`backlog/plan.yaml` line 151 holds `tasks: [TL-143, TL-144, TL-128]`.
`plan` echoes the list as the author wrote it; `run --plan` re-sorts the
wave by priority and, all three being P3, falls through to the id. The
first task of the wave is therefore TL-143 to the reader and TL-128 to the
dispatcher.

**Why the authored order is not noise.** A wave is an ORDER — that is the
argument TL-206 settled when it decided a fleet may not run ahead into a
later wave while an earlier one waits. The same argument applies inside a
wave: an author who writes `[A, B, C]` because B reads A's correction has
no other place to say so, `priority:` being a property of the task rather
than of its position in a sequence. Either the authored order binds the
dispatcher, or it is decoration and `plan` must stop presenting it as the
answer to "what is next".

**This is not TL-206 and not TL-219.** TL-206 was about WHICH WAVES the two
projections walk, and is closed. TL-219 is about what `skippedUnplanned`
counts. This one is about the order WITHIN a single wave, where both
commands agree on the membership and disagree on the sequence.

**Decide, do not patch.** Both readings are defensible - the priority sort
is what makes a wave runnable when it mixes P1 and P3 work - so whoever
takes this should `branchling ask` with options rather than choose
silently.

## Steps

1. Decide whether `plan.yaml`'s authored order binds the dispatcher, or is
   presentation only. Record the answer with `branchling decide`, not in
   prose.
2. Make the two commands agree, whichever way the decision went.
3. If the authored order does NOT bind, `plan` must stop printing "next up"
   as a bare list in file order - it is then a set, and printing it as a
   sequence is the defect.

## Acceptance criteria

- [ ] `plan` and `run --plan --dry-run` list the tasks of one wave in the
      same order, proven by a test that fails against today's code.
      [proof: orders-agree]
- [ ] The choice between the two orders is recorded as a `__decision__`
      event in `backlog/history/TL-257.jsonl`, not argued in this file.
