---
id: TL-232
title: "The served viewer answers 404 when the backlog is not in a git repository"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P2
status: pending
owner: unassigned
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-04
updated: 2026-09-04
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: suite
    bash: "node --test scripts/tests/serve-no-repository.test.mjs"
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
2. Give the served tree a subject that does not come from git, keeping
   `resolveWorktree()` an allowlist for every OTHER key — a foreign key must
   still resolve to nothing, never to the server's own tree.
3. Test in `scripts/tests/serve-no-repository.test.mjs`: `/`, `/api/tasks` and
   `/api/fields` answer over a backlog with no repository. Positive control:
   the same requests over a backlog that IS in a repository keep answering, and
   an unknown `?worktree=` key still gets `404` in both layouts.

## Acceptance criteria

- [ ] `GET /` and `GET /api/tasks` answer `200` for a backlog outside a git
      repository. [proof: suite]
- [ ] An unknown `?worktree=` key still answers `404` — inside a repository and
      outside one. [proof: suite]
- [ ] The switcher's guarantees from TL-188 are unchanged: a foreign tree is
      read-only, and no key resolves to the server's tree by fallback.
      [proof: suite]
