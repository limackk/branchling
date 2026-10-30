---
id: TL-494
title: "A stale mutex is removed only when its content still names the judged holder"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-30
updated: 2026-10-30
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: takeover
    bash: "node --test scripts/tests/mutex-takeover.test.mjs"
---

## Goal

`removeIfUnchanged` in scripts/lock.mjs removes a mutex file only when the file
it moved aside still carries the content that was judged stale, so a live
writer's fresh mutex is never removed because its file happens to reuse the
stale file's inode number.

## Context

TL-481 made the stale takeover rename the file aside and compare its
`(dev, ino)` with the file that was judged. On Linux (ext4, tmpfs) a freed
inode number is handed straight to the next file created in the directory, so
a stale holder unlinked by one contender and replaced by a live writer's mutex
commonly has the SAME `(dev, ino)`. The comparison then reads the live file as
the stale one, removes it, and two writers run inside one section — the very
failure TL-481 was written against.

macOS (APFS) does not reuse inode numbers this way, which is why the suite was
green on the machine that wrote TL-481. CI on ubuntu-latest (Node 18, 20, 22)
fails `a stale mutex replaced by a fresh one before its removal keeps the
fresh one` in scripts/tests/mutex-takeover.test.mjs with "Missing expected
exception" the first time that commit ran there.

Rejected: comparing timestamps (mtime has coarse resolution on some
filesystems and a fresh write can land in the same tick) and dropping the
identity check (it reintroduces the TL-481 race).

## Pre-flight reading

1. `scripts/lock.mjs` — `readHolder`, `removeIfUnchanged`, `withMutex`.
2. `scripts/tests/mutex-takeover.test.mjs` — the interleaving seam and the
   positive controls.

## Steps

1. Keep the raw bytes read by `readHolder` and compare them, together with
   `(dev, ino)`, against the file moved aside.
2. Add a test that rewrites the stale file IN PLACE with a live writer's
   record, which reproduces inode reuse on every platform.
3. Run the suite on macOS and in a Linux container before pushing.

## Acceptance criteria

- [x] a live writer's mutex that reuses the stale file's inode is kept
      [proof: takeover]
