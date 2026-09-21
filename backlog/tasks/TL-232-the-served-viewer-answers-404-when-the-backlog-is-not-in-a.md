---
id: TL-232
title: "The served viewer answers 404 when the backlog is not in a git repository"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-04
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs: []
verification:
  # REWRITTEN while closing (TL-260, TL-424). The single entry named
  # `scripts/tests/serve-no-repository.test.mjs`, a file that did not exist:
  # the closing contract could not run at all, and under a shell glob that
  # matched nothing the same entry would have exited 0 and read as green. Every
  # path below was checked with `test -f` and every command run. The suite-wide
  # entry is kept because this task adds a test that starts real servers, and a
  # file that leaks a listener breaks the suite for everybody else, not itself.
  - id: served-without-git
    bash: "node --test scripts/tests/serve-no-repository.test.mjs"
  - id: viewer-unchanged
    bash: "node --test scripts/tests/viewer-read-only.test.mjs scripts/tests/serve-identity.test.mjs scripts/tests/serve-cross-branch-push.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling serve` over a backlog that is not inside a git repository renders
the page. Today every route answers `404`, so the whole viewer is unreachable
for a backlog nobody has committed yet.

## Context

Measured on 2026-09-04 while writing the test for TL-122. A backlog created by
`branchling init` in a plain directory, served with `branchling serve --dir
<path>`, answers `GET /` with:

    404 {"error":"No worktree of this repository is called ``","worktrees":[]}

The cause is in `subjectFor()` / `subjectOrFail()` in
`scripts/serve-backlog.mjs`. Since TL-188 the served subject is resolved
through the worktree switcher: `listWorktrees()` asks git for the trees of this
repository, `describeWorktrees()` turns them into an allowlist, and the subject
is the entry matching the requested key — with the empty key meaning "this
server's own tree". Outside a repository git lists nothing, so there is no
self entry, the allowlist is empty, and the empty key resolves to nothing. The
`404` is the switcher's message for a stale link, delivered here to a reader who
never used the switcher at all.

Every other reading command already handles this case rather than failing:
`crossBranchState()` returns `reason: "not-a-repository"` and the callers print
`scanNote()`. The server is the one place where the absence of a repository
stops being a narrowing of the answer and becomes no answer at all.

Why this is not TL-122's business: TL-122 adds the cross-branch push loop and
its criterion is only that a server outside a repository keeps behaving AS IT
DOES TODAY and does not log per tick. Repairing what "today" is would be a
second thesis, and its test file's positive control (a real push between two
real worktrees) cannot exist without a repository.

The fix is a design decision, not a patch: the server's OWN tree has to be a
subject that exists whether or not git knows about it, with the switcher
offering the one entry (or none) on top of that — rather than the subject being
derived from the worktree list.

## Pre-flight reading

1. `scripts/serve-backlog.mjs` — `subjectFor()`, `subjectOrFail()` and the
   `GET /` route: where the empty key becomes "no such worktree".
2. `scripts/viewer-worktrees.mjs` — `describeWorktrees()` and
   `resolveWorktree()`: the allowlist, and why it is an allowlist (TL-188).
3. `scripts/tests/viewer-worktree-switcher.test.mjs` — the guarantees the
   switcher already carries, none of which may be weakened by this.

## Steps

1. Reproduce: `branchling init --dir <tmp>/backlog`, then `branchling serve
   --dir <tmp>/backlog --no-open` outside any repository, and request `/`.
2. Give the served tree a subject that does not come from git. TL-379 settled
   this from the other side — it deleted the switcher, the per-request
   `?worktree=` resolution and `viewer-worktrees.mjs` — so no subject is
   derived from git any more and the `404` is gone. What is left to build is
   the measurement, not the repair.
3. Test in `scripts/tests/serve-no-repository.test.mjs`: `/`, `/api/tasks` and
   `/api/ping` answer over a backlog with no repository (`/api/fields` went
   with TL-379). Positive controls: the same requests over a backlog that IS in
   a repository keep answering, an unknown route still gets `404` in both
   layouts, and the fixture's own git state is asserted — otherwise a tmpdir
   inside somebody's repository would make the file measure nothing.

## Acceptance criteria

- [x] `GET /`, `GET /api/tasks` and `GET /api/ping` answer `200` for a backlog
      outside a git repository, and the answer carries the task that is on
      disk. [proof: served-without-git]
- [x] An unknown route still answers `404` — inside a repository and outside
      one — so the `200`s above are not a server answering `200` to
      everything. [proof: served-without-git]
- [x] No request is refused for the tree's git state: `?worktree=` decides
      nothing and the server never names a worktree over a tree git knows
      nothing about. [proof: served-without-git]
- [x] TL-379's read-only surface is unchanged: the removed write routes are
      still refused and the kept ones still answer. [proof: viewer-unchanged]
- [x] The suite is green, with no server left listening by the new file.
      [proof: suite-green]
