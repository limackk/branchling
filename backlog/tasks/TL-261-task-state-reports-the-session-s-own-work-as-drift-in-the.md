---
id: TL-261
title: "task-state reports the session's own work as drift, in the same shape as somebody else's"
type: task
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
  - id: own-work-named
    bash: "node --test scripts/tests/check-task-state-own-work.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`check --task-state` distinguishes the task this session is holding right
now from a closing somebody abandoned. Today both arrive as one `!` line in
one block, and telling them apart costs a reading of `git log`.

## Context

Two agents reported this independently on 2026-09-04, working different
tasks in the same wave, neither having seen the other's output.

The first, mid-flight on TL-143:

    ! task-state: 2 of 257 task file(s) differ from HEAD
      - TL-128 - status: in_progress at HEAD, done on disk
      - TL-143 - status: pending at HEAD, in_progress on disk

The second, mid-flight on TL-144:

    ! task-state: 2 of 257 task file(s) differ from HEAD
      - TL-143 - status: in_progress at HEAD, done on disk
      - TL-144 - status: pending at HEAD, in_progress on disk

In both, the second line is the normal condition - a task taken and not yet
committed - and the first is a real defect: the work was committed and the
closing was left in the tree, which is the divergence law 1 exists against.
They have the same prefix, sit in the same block, and are separated only by
which side of "at HEAD / on disk" the open status falls on.

Both hands resolved it the same way and said so: by reading `git log` and
the diffs by hand.

**The tool already knows the answer.** The reservation naming the holder of
a task is in the state directory, `owner:` is in the file, and the actor is
on the command line. "This is yours, taken at 17:03" and "this is somebody
else's, dropped" are not the same sentence, and the second is the only one
that needs a reader.

**Why it matters more than tidiness.** The abandoned closing is precisely
the case the block exists to catch, and it is being delivered inside the
noise the same block generates about normal work. TL-236 argues that a wall
of warnings trains a reader to skip it; this is that argument with a
measured instance, where the line worth reading and the line worth ignoring
are typographically identical.

**This is not TL-236 and not TL-240.** TL-236 is about the volume of
`check`'s output as a whole. TL-240 is about why the last task of a wave
leaves its closing behind. This one is about the two cases being
indistinguishable once they are both on the screen.

## Steps

1. Separate the two cases in the output: the file this actor holds now, and
   everything else. The second group is the one that carries a remedy.
2. Say which is which in words. The explanatory paragraph under the block
   currently applies to both lines at once, which is why it settles
   neither.
3. Leave the exit code alone - the block is reported, never failed, and
   that decision is not re-opened here.

## Acceptance criteria

- [ ] A task held by the running actor is reported apart from one whose
      closing was abandoned, proven by a test that fails against today's
      code. [proof: own-work-named]
- [ ] `check` still exits 0 on both. [proof: suite-green]
