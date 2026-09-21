---
id: TL-181
title: "The versioned activity rollup has never been committed"
type: task
labels: []
board: main
epic: "History and attribution"
priority: P2
status: done
owner: unassigned
role: ""
executor: ""
estimate: 1h
confidence: medium
created: 2026-09-03
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: the-rollup-is-tracked
    bash: "git ls-files --error-unmatch backlog/activity/rollup >/dev/null 2>&1 || test -z \"$(ls backlog/activity/rollup 2>/dev/null)\""
---

## Goal

Settle whether `backlog/activity/rollup/` is versioned, and make the tree agree
with the answer. Today the ignore rule says one thing and the repository says
another, and nobody has noticed because the disagreement is silent.

## Context

Found 2026-09-03 while auditing the tree after the `branchling` rename. The main
checkout carries `?? backlog/activity/` with **31 untracked files** under
`rollup/`, and it has been there long enough that it was already present at the
start of that session — this is not fallout from the rename.

**The ignore rule is deliberate and explicit about it.** `backlog/.gitignore`
matches `activity/*.jsonl` and says, in a comment written for exactly this
question, that the raw log is somebody's working calendar and must never reach a
public history — but "the per-task AGGREGATE under `activity/rollup/` is NOT
matched here and stays versioned — it is what a report is built from". So the
tool's own documentation says these 31 files belong in git, and they are not
there.

**Why that matters rather than being untidy.** A rollup that lives only in one
working tree is exactly the failure the first law exists to prevent: it does not
travel with the branch, so any report computed from it on another machine is
computed from nothing and cannot tell. It is the same shape of defect as
[TL-43](TL-43-the-history-log-sometimes-goes-untracked-in-git-the-write.md), which
put a guard on the history log for the same reason — and that guard does not
cover this directory.

**What has to be decided, not assumed.** Whether the rollup really should be
versioned. The comment says yes, but the comment was written before the rollup
had contents, and an aggregate of when somebody worked is still information
about a person even when it is summed. If the answer is no, the fix is one line
in the ignore rule and a correction to the comment; if yes, the fix is a commit
plus a guard so it cannot silently drift out of the tree again.

## Pre-flight reading

1. `backlog/.gitignore` — the rule and the comment that states the intent.
2. `backlog/activity/rollup/*.json` — what a rollup entry actually contains, which is what decides the privacy question.
3. `backlog/tasks/TL-43-the-history-log-sometimes-goes-untracked-in-git-the-write.md` — the same defect for the history log, and the guard that closed it.
4. `backlog/tasks/TL-35-raw-activity-log-moves-to-the-home-directory.md` — why the RAW log went to the home directory in the first place.

## Steps

1. Read what a rollup file contains and decide the versioning question on that evidence, not on the comment.
2. If versioned: commit the 31 files, and extend the guard that covers `history/` so an untracked rollup fails the same way.
3. If not versioned: change the ignore rule to match the whole directory and correct the comment, which currently states the opposite.
4. Either way, make `check` able to tell — the current state passes every guard while contradicting the tool's own documentation.

## Acceptance criteria

- [x] The tree and the ignore rule agree, and a guard fails if they stop agreeing. [proof: the-rollup-is-tracked]
- [ ] The decision is recorded with the reason, including what a rollup entry reveals about a person.
- [ ] If versioned, the 31 existing files are in git; if not, they are ignored and the comment no longer promises otherwise.

## Decisions

- **Not fixed in passing during the rename.** Committing 31 files of somebody's
  activity data is a decision about what this repository publishes, not a tidy-up
  — and the rename had no business making it.
