---
id: TL-26
title: "next-backlog-id.mjs finds nothing when the backlog is the git repository root"
type: code
labels: [pre-launch]
board: main
epic: "branchling — the tool"
priority: P2
status: done
owner: claude
estimate: 1h
confidence: high
created: 2026-08-30
updated: 2026-08-30
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "mkdir /tmp/x && cd /tmp/x && git init -q && node <path>/init-backlog.mjs --dir . && echo 'id: BL-1' > tasks/BL-1-x.md && git add -A && git commit -qm x && node <path>/next-backlog-id.mjs --dir . --explain  # should show BL-1, today: “no BL-* found AT ALL”"
---

## Goal

`next-backlog-id.mjs` has one condition that is always true: when the backlog
IS the root of a git repository (not a subdirectory), the script finds
nothing and exits with an error — even though tasks exist and are committed.

## Context

Found while writing tests for [TL-25](TL-25-domknij-walidacje-flag-w-5-komendach-tasklog.md)
(flag validation) — a separate, unrelated defect in the same file.

Cause — `BACKLOG_REL`:

```js
const rel = relative(root, dir);
return rel && !rel.startsWith('..') ? rel : 'backlog';
```

`relative(root, dir)` returns an **empty string** when `dir` (the backlog)
and `root` (the repo root from `git rev-parse --show-toplevel`) are the same
directory. An empty string is falsy, so the ternary silently substitutes
`'backlog'` — treating it as if the relative path were "invalid" (as it would
be for `../somewhere`), rather than as "the backlog sits AT the root."

Effect: `fromWorkingTree()` and `fromRef()` look for `<root>/backlog/tasks`,
which does not exist (the tasks are directly in `<root>/tasks`). Zero numbers
in the union → `exit 2`, "found NO BL-* at all."

**Why this is not theoretical:** this is exactly the layout that
[TL-23](TL-23-tasklog-init-i-stats.md) leads to — `worktrail init --dir .`
in a freshly created open-source repository, where the backlog IS the whole
repo, not a subdirectory of a workspace (as in the origin project). The first `worktrail
new` in such a repo would get `BL-1` from the fallback local path instead of
from a real branch scan — harmless with a single branch, but the warning
"WARNING: number from a LOCAL scan" would appear on EVERY invocation,
confusing anyone with no idea why.

## Steps

1. Fix the condition: an empty string must be treated as a valid relative
   path (backlog = root), distinct from `undefined`/`null` (backlog outside
   the repo, where `resolveBacklogDir` would throw and land in the `catch`).
2. `fromWorkingTree`/`fromRef` — `join(root, BACKLOG_REL, 'tasks')` with an
   empty `BACKLOG_REL` must give `join(root, 'tasks')`, not
   `join(root, '', 'tasks')` with the literal `''` treated as a segment
   (check whether `node:path.join` handles this correctly — it should, but
   add a test).
3. Regression test: backlog as the git repo root, one committed task,
   `next-backlog-id.mjs --explain` must return the correct number.

## Acceptance criteria

- [x] Backlog at the git repository root: `next-backlog-id.mjs` finds the tasks and computes `max+1` correctly.
- [x] Backlog in a subdirectory (the origin project's current case) untouched — a positive control in the same test file.
- [x] `worktrail new` in such a repo does NOT show the local-scan warning.

## Notes

Not fixed in TL-25 deliberately — a different defect from flag validation,
found while writing the test, not in that task's scope. The test for TL-25
works around this case by nesting the backlog in a subdirectory of the repo
(`repo/backlog/`) — in order to measure flag validation, not this separate
bug.

## Log

- 2026-08-30 created — claude — found while writing regression tests for TL-25
- 2026-08-30 done — claude — fixed TWO bugs in the same function, not one. (1) an empty string mistaken for an invalid path (described in the task). (2) `fromRef()` built the pathspec by string concatenation (`BACKLOG_REL + '/tasks'`), which for an empty BACKLOG_REL gave `/tasks` — git reads a leading `/` as an ABSOLUTE path and fails with "is outside the repository," not as "from the repo root." `fromWorkingTree()` uses `path.join()` and did not have this flaw — so fix (1) alone was not enough: the test "the number sees tasks from OTHER branches" was still red, because that path goes through `fromRef`, not `fromWorkingTree`. Along the way: the tests in this file also hit an environment artifact (macOS symlinks /tmp→/private/tmp, /var→/private/var), which made `relative()` between a path from git (resolved) and a path from `resolveBacklogDir` (unresolved) produce a false ".." even for a correct layout — fixed with `realpathSync` before `relative()`, so the test measures the BACKLOG_REL logic, not a filesystem quirk.
</content>
