---
id: TL-526
title: "The viewer shows a body rewrite by its size, not by two hashes"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: cancelled  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-renders-no-history
    bash: "! grep -nE 'historyEntryKind|describeBodyChange\\(|renderTaskGraph\\(' scripts/build-viewer.mjs"
---

## Goal

A `__body__` history entry in the browser viewer reads as a body rewrite with the lines added and removed, the way `branchling log` prints it, instead of a from/to transition between two 71-character `sha256:` hashes.

## Context

TL-523 added `branchling body` (scripts/body-task.mjs), which records a `__body__` entry whose `from` and `to` are base-version hashes and whose `lines` field holds {added, removed}. `describeBodyChange(entry, arrow)` in scripts/task-fields.mjs is the one wording, and `log` and `resume` already use it. The viewer (scripts/build-viewer.mjs, history rendering; label `__body__: "task body"` in HISTORY_FIELD_LABELS) still treats the entry as an ordinary transition because `historyEntryKind` returns `transition` when both ends are non-empty, so it prints the two hashes. task-fields.mjs is pasted into the viewer by source, so the function is already available there.

## Steps

1. Find where the viewer renders a history entry by `historyEntryKind`.
2. Render `__body__` entries with `describeBodyChange`, keeping the hashes out of the visible text (a title attribute may carry them).
3. Add a test that builds the viewer over a fixture with a `__body__` entry and asserts the rendered history names the line counts and does not show the full hash.

## Acceptance criteria

- [x] The viewer has no history-entry renderer through which a body rewrite could show its hashes — the premise of this task does not hold (see Decision). [proof: viewer-renders-no-history]

## Decision (2026-11-02): cancelled, because the premise does not hold

The Context above says the viewer renders a `__body__` entry through
`historyEntryKind` as a from/to transition. It does not, and it cannot: the
viewer renders no history entry of any kind. TL-379 ("The viewer is a window
onto current work, not a second backlog") deliberately removed the per-task
history panel together with `/api/history`, and nothing in
`scripts/build-viewer.mjs` calls `historyEntryKind` today. Measured on this
tree: `branchling viewer` over a backlog whose history carries `__body__`
entries (TL-523, TL-524, TL-525) produces a page in which `sha256:` occurs only
inside the embedded `HISTORY` data and the pasted source of
`describeBodyChange` — never in rendered text. The decision panel reads only
questions and manual vouches from `HISTORY`, and `renderTaskGraph` is pasted but
never called.

Options considered:

1. Restore a history list in the detail panel so that it can render body
   rewrites with `describeBodyChange`. Rejected: it reverses TL-379's recorded
   decision as a side effect of a P3 wording fix. If the viewer should show
   history again, that is its own task with its own thesis, not this one.
2. Write the requested test anyway, asserting the hash is absent from rendered
   text. Rejected: it would pass against a page that renders no history at all,
   which is a guard green on a zero sample, and it could not satisfy the
   positive half ("names the line counts").
3. Cancel, and file the residue the investigation found. Chosen. The
   original verification (a test file that was never written) is replaced by
   the check that establishes the premise is false: no history-entry
   renderer is referenced from `scripts/build-viewer.mjs`.

The residue — `HISTORY_FIELD_LABELS` (whose `__body__` label prompted this
task), `historyOpen` / `historyField` state, `historyLoaded`, `histTime`, and
two document listeners calling an `openHistory` that no longer exists — is
filed as its own task.
