---
id: TL-122
title: "The viewer's push does not see a status change in another worktree"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P3
status: pending
owner: unassigned
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-state-and-sync.md
verification:
  - id: suite
    bash: "node --test scripts/tests/serve-cross-branch-push.test.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
  - id: manual-two-trees
    manual: "With a page open from `worktrail serve` in the main checkout: running `worktrail take <ID>` in a SECOND worktree makes the `<worktree>: in_progress` badge appear on the card without reloading the page"
---

## Goal

An open viewer page shows a task being taken in another worktree without a
reload. Today the cross-branch status signal (TL-73) works on READ, but not
on push: the page goes stale, and the reader has no reason to press F5.

## Context

`GET /` renders HTML per request (`scripts/serve-backlog.mjs:377-386`), so
after a reload the `elsewhere` badge is up to date — the data is fine, the
problem is entirely in notification.

The push to the browser hangs on a single `fs.watch` over its OWN
`backlog/tasks` (`scripts/serve-backlog.mjs:267-273`). `worktrail take <ID>`
run in another worktree writes a file in THAT TREE'S directory — locally
nothing changes, so the watcher does not fire and SSE stays silent. The same
applies to a commit on someone else's branch.

Why this is a defect and not cosmetic: `crossBranchState()` exists so that the
view from one checkout does not LIE about the rest of the repository. A page
that holds a stale scan and looks alive (because it gets pushes on local
edits) is the same failure mode, just harder to notice than a static file.

Traps to resolve along the way:

1. **Do not set up a watcher on other worktrees.** Their list changes over
   the server's lifetime (worktrees are created and removed), and every new
   watcher is a descriptor nobody closes. Polling `crossBranchState()` at an
   interval is cheaper and does not depend on whether the file was dirty or
   committed.
2. **Push only on a DIFFERENCE.** SSE should fire when the scan result
   changes, not every tick — otherwise the page keeps redrawing and pushes
   stop meaning anything.
3. **The interval is a configuration value, not a literal** (law III). The
   scan runs `git`, so the frequency is a cost the project decides on. The
   scan switch (`crossBranchState: false`) MUST also disable this loop.
4. **The server is sometimes outside a git repository** — then the scan does
   not run (`reason`) and the loop has nothing to watch; a warning must not
   be logged every tick.

## Pre-flight reading

1. `scripts/serve-backlog.mjs:245-273` — reconcile + `fs.watch` +
   `notifyClients()`.
2. `scripts/branch-scan.mjs:400-430` — `crossBranchState()` and its `reason`.
3. `scripts/build-viewer.mjs:200-222` — where `elsewhere` enters the task.

## Steps

1. Compute a hash of the `crossBranchState()` result (a pair `id →
   observations`) at a configured interval; send an SSE event when the hash
   changes.
2. A configuration key for the interval in the project layer; an unknown key
   fails. A disabled scan means no loop.
3. Test: a fixture with two worktrees, a take in the second one, an expected
   SSE event WITHOUT a reload. Positive control: nothing fires when there is
   no change.

## Acceptance criteria

- [ ] A task's status change in another worktree triggers pushes to the open
      page. [proof: suite]
- [ ] No change triggers no push — the test has a negative and a positive
      control. [proof: suite]
- [ ] The interval is a project configuration key, and a disabled scan
      disables the loop. [proof: suite]
- [ ] A server outside a git repository behaves as today and does not log a
      warning in the loop. [proof: suite]
- [ ] The rest of the tests stay green. [proof: no-regression]
