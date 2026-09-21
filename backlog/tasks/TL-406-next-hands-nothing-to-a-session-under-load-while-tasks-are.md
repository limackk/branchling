---
id: TL-406
title: "next hands nothing to a session under load while tasks are free"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-session-comes-back-empty
    bash: "node --test scripts/tests/next.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Six sessions asking `next` at the same moment, against six free tasks, are
handed six tasks. Today one of them is sometimes handed nothing, and the test
that measures it is intermittently red — which makes every contract in this
repository that runs the whole suite intermittently red with it.

## Context

Measured on 2026-09-21 in the main checkout, at `e70ac7f`, while landing wave
one of the plan. `scripts/tests/next.test.mjs:360`, "two sessions asking at the
same moment never get the same task":

    AssertionError: some sessions came back empty-handed
      actual: 5
      expected: 6

It failed on a full-suite run (`node --test scripts/tests/*.test.mjs`, 1713
tests) and passed on the immediately following full-suite run, and the file
passes 43/43 every time it is run on its own. The difference is load: the whole
suite runs files concurrently, so the six `next` children in that fixture
compete with every other test's subprocesses for the machine.

**What did NOT fail is the part the test exists to defend.** No task was handed
to two sessions; the mutual exclusion held. What failed is the other half of
the same promise: a session that asks while work is free must be given work.
`scripts/lock.mjs` reserves with `link()` and the loser of a race has to retry
or look at the next candidate; under load one loser evidently ran out of
candidates, or its retry window closed, and `next` answered "nothing for you"
while five other sessions were being handed tasks from the same six.

**Why this matters more than one flaky line.** This repository's claim is that
a task closes only on a run that could have failed. A suite that is red once in
a while for a reason nobody can attribute trains the next hand to re-run it
until it is green, which is the exact opposite: a run that cannot fail, because
failure is re-rolled. TL-276 gave a hand the vocabulary to ask whose red a
failure is; it answers with a task id, and it cannot say "this one is nobody's,
run it again".

**A second test of the same class, measured later the same day.** While
TL-284 was closing, `scripts/tests/ui.test.mjs`, "the same call with and
without colour carries IDENTICAL content", failed once inside a heavily loaded
full-suite run and passed on every run afterwards; the two `check` outputs were
byte-identical when reproduced by hand immediately. That is a second test whose
result depends on machine load rather than on the code, which makes "the suite
is red, whose is it" a question about this repository generally and not only
about `next`. It is recorded here rather than as a third task because a fix for
one may or may not cover the other, and that is exactly what step 1 has to
measure.

**Two candidate causes, both testable.** Either `next` gives up too early when
`link()` loses — a bounded retry that is too short under load — or the
candidate set it walks is computed once, before the losses, so five winners
leave the sixth session with a list of tasks that are all taken. The second is
the one that would also explain why the failure is starvation rather than a
crash.

## Steps

1. Reproduce deliberately: run the `fleet(6, …)` fixture under artificial load
   (more children than cores, or the suite's own concurrency) until the empty
   hand appears. A fix cannot be trusted while the failure is only ever seen by
   accident.
2. Decide what `next` promises a loser: retry until the candidate list is
   genuinely exhausted, recompute the list after a lost reservation, or answer
   "nothing" only after re-reading the tree. Record it with `branchling decide`.
3. Make the test assert the promise rather than the timing — the fix must be
   the reservation, not a longer sleep in the fixture.

## Acceptance criteria

- [ ] Six concurrent `next` calls against six free tasks hand out six tasks,
      under load, proven by a run that fails against today's code.
      [proof: no-session-comes-back-empty]
- [ ] No task is handed to two sessions; the exclusion this test already
      defends is unchanged. [proof: suite-green]
