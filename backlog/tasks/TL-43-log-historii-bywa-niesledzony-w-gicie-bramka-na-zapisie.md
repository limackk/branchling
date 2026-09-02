---
id: TL-43
title: "The history log sometimes goes untracked in git — the write-time gate loses its premise"
type: bug
labels: []
board: main
epic: "History and attribution"
priority: P2
status: done
owner: agent:claude
estimate: 2h
confidence: medium
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: guard-behaviour
    bash: "node --test scripts/tests/history-tracked.test.mjs"
  - id: this-tree
    bash: "node scripts/cli.mjs check --history"
  - id: in-the-default-run
    bash: "node scripts/cli.mjs check --help | grep -q -- '--history' && echo 'the selector is documented — OK'"
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

One line each: the parser reads the `- [ ]` line and nothing under it (TL-118).

- [x] An untracked history log is reported with its file name and a nonzero exit. [proof: guard-behaviour]
- [x] Outside a git repository the command says there is nothing to check, and does NOT print a tick it did not earn. [proof: guard-behaviour]
- [x] Positive control: a repository with one untracked log fails, and the same repository passes after `git add`. [proof: guard-behaviour]
- [x] An orphaned log — one with no task — is counted apart from an untracked one. [proof: guard-behaviour]
- [x] The guard runs in a bare `check`, and `--history` selects it alone. [proof: guard-behaviour, in-the-default-run]
- [x] This repository passes its own guard. [proof: this-tree, guard-behaviour]

## Decision (2026-09-02)

**Yes, it is the tool's job — as a guard that is honest about git rather than
one that assumes it.** Step 1 asks the question and the answer turns on the
second half of it: `--dir` may point outside any repository, so the guard says
"not a git repository — nothing to check about tracking" and exits 0. It does
NOT print a tick, because a tick is a claim that the logs are safely versioned,
and a run that never looked at a repository has not earned one.

**The failure condition is the ASYMMETRY, not the absence, and that settles step
4.** "This log is untracked" is not by itself a defect: a backlog nobody has
committed yet has no tracked anything, and a guard failing there would make
`check` red on a fresh `init` — the worst possible first minute with the tool.
What IS a defect is a log untracked while its OWN task file is tracked, because
that pair can only mean the log was left behind. Stated that way the guard is
safe in the default run, which is where it has to be: a guard wired to nothing
passes every test of its own, and this repository has a test with that exact
name.

**An orphan reports and does not fail, and this tree contains the reason.**
`backlog/history/TL-1546.jsonl` has no task, and its single row is a
`__deleted__` tombstone from the renumbering — a legitimate record of a task
that no longer exists. Failing on it would demand deleting an append-only log to
make a guard green. The other common orphan is a task living on another branch,
which is the whole point of data travelling with branches. Both are counted
apart from the untracked ones: one is somebody's other branch, the other is
somebody's missing commit, and a single number would hide both.

**A defect the first test run caught in the guard itself.** `git rev-parse
--show-toplevel` answers with the REAL path, and on macOS `/var` is a symlink to
`/private/var` — so in a temporary directory the repository root and the backlog
root shared no prefix, every path computed as `../../..`, nothing matched `git
ls-files`, and the guard read that as "nothing is tracked" and passed. It was
green for the same reason an empty sample is green: an empty set has no
asymmetry in it. Both roots now go through `realpathSync`.

**Step 5 is out of reach and is not silently dropped.** The 28 untracked logs
were measured in `origin`, a repository this one was extracted from and
cannot touch. What this task can deliver is the guard that finds them, and it
does; running it there is somebody's command in that tree, not a change to this
one. This repository's own 157 logs are all tracked, which is what the
`this-tree` verification asserts.

## Verification

```bash
# 1. The guard's behaviour, against real repositories — expected: pass
node --test scripts/tests/history-tracked.test.mjs

# 2. This tree passes — expected: every log tracked
node scripts/cli.mjs check --history

# 3. The selector is documented — expected: OK message
node scripts/cli.mjs check --help | grep -q -- '--history' && echo 'the selector is documented — OK'
```

## Notes

- A more general class: data produced by a tool alongside a file a human
  adds by hand is invisible to any of git's safety nets.

## Log

- 2026-08-31 created — claude — split out from TL-39 after measuring 28/71
  untracked history logs; TL-39 closed the symptom (dedup at read time), this
  task closes the delivery path
