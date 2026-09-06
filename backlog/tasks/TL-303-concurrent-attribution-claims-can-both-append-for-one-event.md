---
id: TL-303
title: "Concurrent attribution claims can both append for one event"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/history.mjs
  - scripts/history-record.mjs
verification:                      # HOW to check the task is really done
  - id: concurrent-claim
    bash: "node --test scripts/tests/history-attribution-concurrency.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Only one process can append the first attribution claim for an event. Concurrent
claims are serialized or one is refused after observing the winner, so a log
cannot represent two people as the first good-faith claimant.

## Context

TL-302 added event-level selection and rejects a request that is already
ambiguous when the command reads the log. The read and append remain separate,
however: two processes can both observe one event as unclaimed and both append
an `__attributed__` entry. `unattributedChanges()` then hides the duplicate, but
the append-only file permanently carries two claims.

Use the existing repository-scoped mutex design or an equally small atomic
boundary. Do not deduplicate or rewrite history after the fact; the loser must
be refused before its line is appended.

## Pre-flight reading

1. `scripts/history.mjs` — inspect the selection-to-append boundary in
   `attributeChanges()`.
2. `scripts/history-record.mjs` — preserve event selection and refusal output.
3. `scripts/lock.mjs` — reuse the cross-process critical-section primitive.
4. `scripts/tests/history-attribution-target.test.mjs` — keep the sequential
   selection contract intact.

## Steps

1. Add a real multi-process test in which several claimants target one event.
2. Place the final eligibility check and attribution append in one critical
   section shared across worktrees.
3. Re-read eligibility inside the section and refuse every loser without an
   append.
4. Preserve append-only history and the single-process command output.

## Acceptance criteria

- [ ] Several concurrent claims for one event append exactly one attribution
      entry. [proof: concurrent-claim]
- [ ] Every losing process is refused and the original event remains unchanged.
      [proof: concurrent-claim]
- [ ] Existing attribution and history behavior remains green.
      [proof: suite-green]
