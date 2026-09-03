---
id: TL-195
title: "the post-edit hook reconciles whatever tree the cwd points at"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:dev
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: hook-target-tree
    bash: "node --test scripts/tests/hook-target-tree.test.mjs"
---

## Goal

`scripts/regen-hook.mjs` must reconcile the history of the tree the EDITED FILE
lives in, not the tree the current working directory happens to point at.

## Context

The hook already resolves the file's own backlog root — `backlogForTaskPath()`
returns `target`, and `build-backlog.mjs` is spawned with `--dir target.root`.
The `history-record.mjs` spawn on the next lines passes `--file` and `--actor`
and **no `--dir`**, so that process falls back to the rest of the chain in
`resolveBacklogDir()`: `BACKLOG_DIR`, then discovery upwards from cwd, then
co-location.

The two agree whenever the session's cwd is inside the same checkout as the
file, which is the ordinary case and why nothing has failed yet. They diverge
when a session standing in one worktree edits a task file in another, or when
`BACKLOG_DIR` is set to a third tree: `build` then rebuilds the right views
while `history` diffs a DIFFERENT directory, advances that directory's snapshot
and appends entries about a file it was never asked about.

This is the class of defect CLAUDE.md names outright — the data directory is
resolved by `resolveBacklogDir()`, and a caller that knows the answer and
declines to pass it on is relying on a coincidence. The hook swallows all output
(`stdio: ignore`), so a wrong tree is silent by construction.

Found while working on TL-185, whose defect was in the same file's call site but
not this one: a `--file` seed writing a one-task snapshot. That is fixed; this
is separate and was deliberately left out of it.

## Steps

1. Pass `--dir`, `target.root` to the `history-record.mjs` spawn in
   `scripts/regen-hook.mjs`, beside the `--file` argument.
2. A test that edits a task in tree A with the cwd in tree B and asserts that
   A's `history/` gained the entry and B's did not. It must fail against the
   current code — a hook test that passes with the cwd inside A proves nothing.

## Decisions

**The fix is the argument that was missing, not a new resolution rule.** The
hook already resolves the file's own root with `backlogForTaskPath()` and hands
it to `build-backlog.mjs`; the `history-record.mjs` spawn beside it now gets the
same `--dir`. `--dir` is the one source that outranks `BACKLOG_DIR`, so passing
the root that is already computed is what closes both divergences the task
names.

**Rejected: teaching `history-record.mjs` to derive the root from `--file`.**
That would put a second definition of "which tree owns this file" beside
`resolveBacklogDir()`, and it would only cover the callers that pass a file. The
defect is a caller that knows the answer and declines to pass it on; the repair
belongs at that call site.

**Deliberately not done: the hook still runs with `stdio: ignore`.** The silence
that makes this class of defect invisible is real, but a hook that fires after
every edit cannot start printing on the unrelated ones, and choosing what it may
say is a separate design decision — not something to settle inside a one-argument
fix.
