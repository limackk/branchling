---
id: TL-272
title: "The resume briefing shows uncommitted work, not only what was committed"
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
blocked_by: [TL-151]               # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`resume <ID>` reports the work a dead session left in the WORKING TREE as well
as the work it committed. A session that died with edits it never committed is
briefed today as though it had written nothing, which is the state a killed
session is most often in.

## Context

TL-151 built the briefing as `git diff <merge base> HEAD` — the branch's
committed work, and nothing else. That was the range its Steps named, and it is
the right range for "what has this branch done that `main` has not". It is the
wrong range for the question `resume` is actually asked, because the session
being resumed did not choose the moment it stopped: it was killed, and the most
recent thing it wrote is exactly the thing least likely to be in a commit.

The failure is silent, which is what makes it worth a task rather than a note.
The section prints `No commit on this branch since the merge base.` for a
session that has an hour of uncommitted edits on disk, and a successor that
believes it starts the work again from the beginning.

Two things are missing and they are not the same:

- TRACKED files edited since HEAD — `git diff HEAD`;
- UNTRACKED files, which no `git diff` reports at all and which are where a new
  module lives before anybody adds it.

The open question is presentation, not collection: three ranges printed one
after another is a section a reader has to reconcile, and the whole thesis of
TL-151 is that the ORDER and the boundaries of the briefing are the product. A
plausible answer is one section with committed work first and "and not yet
committed" after it, under a heading that says both are there.

## Pre-flight reading

1. `scripts/resume-task.mjs` — `branchDiff()` is where the range is chosen, and
   `renderBriefing()` where the section is laid out.
2. `scripts/tests/resume-briefing.test.mjs` — the existing fixture already
   builds a branch, moves `main` underneath it and writes an untracked file, so
   the positive control for this is nearly there.

## Steps

1. Collect the uncommitted half: tracked edits against `HEAD`, and the untracked
   files `git status --porcelain` reports.
2. Decide how the two halves share one section, and say why in a comment.
3. A fixture whose session left BOTH an uncommitted edit to a tracked file and a
   new untracked file, and a positive control that the same briefing over a
   clean tree does not report either.

## Acceptance criteria

- [ ] An edit to a tracked file that was never committed appears in the briefing.
      [proof: suite-green]
- [ ] A file the session created and never added appears in the briefing.
      [proof: suite-green]
- [ ] Positive control: over a clean tree the briefing reports neither, so the
      assertions above are not satisfied by a section that prints everything.
      [proof: suite-green]
- [ ] The committed and the uncommitted work are told apart in the output — a
      successor must know which of the two a line came from. [proof: suite-green]
