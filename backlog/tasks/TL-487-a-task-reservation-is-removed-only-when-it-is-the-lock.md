---
id: TL-487
title: "A task reservation is removed only when it is the lock judged expired"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-10-26
updated: 2026-10-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: reservation-takeover
    bash: "node --test scripts/tests/lock-takeover.test.mjs"
  - id: next-suite
    bash: "node --test scripts/tests/next.test.mjs"
---

## Goal

A task reservation taken by `take` or `next` is never removed by a contender that read the name while it was absent or while it held a different, older record: `acquireLock` in `scripts/lock.mjs` removes a lock file only when it is the very file it judged expired.

## Context

TL-481 found that `withMutex` treated an ABSENT holder file like a corrupt one: a contender whose create failed read ENOENT (the holder had just released), judged that as no holder, and unlinked whatever stood under the name by then — possibly a third process's fresh mutex. Sixteen processes measured two writers inside one section 3 to 8 times in 4800 entries. TL-481 fixed `withMutex` with `readHolder` (record and inode read through one descriptor; absence retries and removes nothing) and `removeIfUnchanged` (rename aside, compare inode, link back a file that is not the judged one).

`acquireLock` has the same shape and was deliberately left out of TL-481, whose thesis is the id mutex: after `createExclusively` fails it calls `readLock`, which returns null for an absent file as well as a corrupt one; `isExpired(null)` is true; and the following `unlinkSync(path)` can remove a reservation another session created in between. Reservations are held for long and released rarely during contention, so the window is narrower than the mutex's was, but the consequence is the one TL-87 exists to prevent: two sessions handed the same task.

## Steps

1. Reproduce with a stress harness: many processes taking and releasing the same task id through `acquireLock`/`releaseLock`, counting moments where two hold it.
2. Reuse `readHolder` and `removeIfUnchanged` from `scripts/lock.mjs` in `acquireLock`, so absence retries and a removal only ever takes the file that was judged expired.
3. Add tests that force the two interleavings deterministically (released and re-taken before the read; expired lock replaced before its removal), with a positive control that an expired or corrupt reservation is still taken over.

## Acceptance criteria

- [ ] A reservation is removed only when it is the file judged expired, and an expired one is still taken over. [proof: reservation-takeover]
- [ ] Taking and reserving tasks still behaves as before. [proof: next-suite]
