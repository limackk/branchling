---
id: TL-43
title: "The history log sometimes goes untracked in git — the write-time gate loses its premise"
type: bug
labels: []
board: main
epic: "History and attribution"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node scripts/cli.mjs check --history"
---

## Goal

The file `backlog/history/<ID>.jsonl` is meant to be **versioned** — it is
what carries attribution between trees. Today nothing guards that it
actually reaches git, so it sometimes goes untracked and fails to arrive
where it is needed.

## Context

Measured on 2026-08-31 in a consumer repository (`origin`): **28 of
71** history logs were untracked, while the corresponding task files were
committed.

The cause is procedural, not technical: the rule "`git add` with enumerated
paths" (deliberate and sound — it protects against sweeping up someone
else's work) means the `.md` gets added because you're thinking about it,
while the `.jsonl` does not, because it was created alongside it, without a
human's involvement.

**Why this is not cosmetic.** The gate from TL-17 — reconciliation checks the
history file before appending `__created__` — only works when there is
something to read. The `.md` travels with git, the `.jsonl` only when
someone added it. This is exactly how the third occurrence of the duplicate
from TL-39 happened, AFTER that fix: a second tree saw a task with no history
and honestly took it for new.

TL-39 added a second layer at read time, so **the symptom is closed** — but
at a cost: until the log arrives, attribution is reconstructed only after the
fact, and metrics computed in a tree without the log are computed from
incomplete data.

## Steps

1. Decide whether this is the tool's job. `worktrail` by design does not know
   about git (`--dir` may point at a directory outside a repository), so the
   gate must be optional and **silent when there is no git** — not green
   when there is.
2. `worktrail check --history`: for every task in `tasks/`, check whether its
   log (if it exists) is tracked. Nonzero exit when there are untracked
   ones.
3. Consider the other side: a log WITHOUT a task (orphaned after a prefix
   change or after the file was deleted) — that is a different defect, but
   the same command sees it.
4. Decide whether `check --history` joins full `check` (in which case it
   fails trees where nobody has committed logs yet) or stays opt-in.
5. In the consumer repository: add the 28 untracked logs to git — as a
   separate commit and after checking that none of them is someone else's
   work in flight.

## Acceptance criteria

- [ ] An untracked history log is reported with its file name and a nonzero
      exit.
- [ ] Outside a git repository the command does **not pretend** it checked —
      it says there is nothing to check, and that is visible in the output.
- [ ] Positive control: a repository with one untracked log fails, the same
      repository after `git add` passes.
- [ ] An orphaned log (without a task) is recognized separately from an
      untracked one — these are two different defects, and conflating them
      obscures both.

## Notes

- A more general class: data produced by a tool alongside a file a human
  adds by hand is invisible to any of git's safety nets.

## Log

- 2026-08-31 created — claude — split out from TL-39 after measuring 28/71
  untracked history logs; TL-39 closed the symptom (dedup at read time), this
  task closes the delivery path
