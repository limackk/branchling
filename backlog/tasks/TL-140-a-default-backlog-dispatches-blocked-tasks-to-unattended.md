---
id: TL-140
title: "A default backlog dispatches blocked tasks to unattended agents"
type: task
labels: []
board: main
epic: ""
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: fresh-backlog-protects-it
    bash: "node --test scripts/tests/next.test.mjs scripts/tests/run.test.mjs scripts/tests/config.test.mjs"
  - id: decided-in-writing
    manual: "Read the decision recorded in this task and in the commit that closes it: whether a fresh `worktrail init` backlog dispatches its stuck status is now stated somewhere a reader will find it, not left to be discovered"
---

## Goal

A backlog created by `init` does not hand a `blocked` task to an unattended
agent — or, if it deliberately does, that is a stated decision rather than a
consequence nobody chose.

## Context

Found while building `worktrail run` (TL-96, 2026-09-01). The dispatcher's
queue is DERIVED: `statuses` minus `archived_statuses` minus the in-progress one
minus `reason_required_statuses`. `init` does not write
`reason_required_statuses`, and an absent key resolves to `archived_statuses`
(config.mjs) — so in a fresh backlog the queue is `pending` AND `blocked`.

Two things follow, and both are already visible:

- README.md says, of `next`: "Two statuses are never handed out unattended: the
  one that means *in progress* and any status your `reason_required_statuses`
  protects — `blocked` was entered by a decision, and an agent must not undo it
  silently." In a default backlog that sentence describes nothing: `blocked` is
  not protected, so it IS handed out. The documentation is not wrong about the
  mechanism, it is wrong about the default.
- `worktrail run` refuses to start on such a backlog. It has to: it parks a task
  it could not finish in the stuck status, and a stuck status the dispatcher
  still hands out is a queue that never empties. The refusal names the key, so
  the first run of the flagship loop on a fresh backlog is an error message.

This repository's own `backlog/config.yaml` declares
`reason_required_statuses: [blocked, cancelled]`, which is why none of this was
noticed here — the one backlog every test of the tool is written against is the
one that does not have the problem.

The decision, which is what makes this a task and not a fix:

- change what `init` WRITES (a declared `reason_required_statuses` in the
  generated config.yaml, visible and editable), or
- change what an ABSENT key resolves to in `config.mjs` (silent, and it moves
  every existing backlog that never declared the key), or
- state that dispatching `blocked` is correct by default and repair the README
  sentence instead.

The first is the least surprising and the third is the cheapest; the second
changes behaviour for backlogs whose owners never asked for it, and TL-105 chose
the current fallback deliberately, so overturning it needs its own argument.

## Pre-flight reading

- `scripts/config.mjs` — `reason_required_statuses`, and the comment explaining
  why an absent key resolves to `archived_statuses` (TL-105).
- `scripts/next-task.mjs` — `queueStatuses()`, where the queue is derived.
- `scripts/run-loop.mjs` — `stuckStatus()`, and the refusal this produces.
- `scripts/init-backlog.mjs` — the config.yaml a new backlog is given.
- README.md, the paragraph about statuses never handed out unattended.

## Steps

1. Pick one of the three answers above and write down why.
2. Apply it, including the README if the sentence there stops being true.
3. A test that a FRESH `init` backlog agrees with the documentation, whichever
   way the decision went.

## Acceptance criteria

- [ ] A backlog straight out of `init` and the README say the same thing about which statuses are handed out unattended. [proof: fresh-backlog-protects-it]
- [ ] `worktrail run` either starts on a fresh backlog, or its refusal is a deliberate, documented consequence. [proof: fresh-backlog-protects-it]
- [ ] The decision is recorded where a reader will find it, not only in a commit body. [proof: decided-in-writing]
