---
id: TL-71
title: "The server does not know whose backlog it holds — a ping without a directory"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P1
status: done
owner: agent:claude
estimate: 2h
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  # One entry for the WHOLE file, not one per criterion: a `--test-name-pattern`
  # that matches no test ends green with zero tests run, so such a proof would
  # be green with no evidentiary force. Every test here has its own positive control.
  - id: identity
    bash: "node --test scripts/tests/serve-identity.test.mjs"
  - id: no-stale-name
    bash: "! grep -n 'origin' scripts/serve-backlog.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`worktrail serve` started in project A, when a server for project B is already
sitting on port 4321, is to **start its own server** and say why it took a
different port — instead of silently opening a tab with project B's backlog.

After this task the answer to "whose backlog am I looking at in the browser"
is available programmatically (`/api/ping`), not only via `ps aux | grep`.

## Context

Report: "why don't I see the TL tasks in the browser". A process was running
on 4321, started from the worktrail script but with `cwd` in a different
repository, so `resolveBacklogDir()` detected that project's backlog upwards
and served 1378 tasks that were not ours.

`cwd` alone is not the whole cause here. A second launch — this time from the
correct directory — would **also** show someone else's tasks, because the
start is preceded by a probe:

```js
// serve-backlog.mjs:437-443
{ host: "127.0.0.1", port, path: "/api/ping", timeout: 500 }
resolve(JSON.parse(body).app === PING_ID);
```

`/api/ping` (`serve-backlog.mjs:342`) returns `{ app, pid }` — **without the
backlog directory**. The probe therefore recognizes "some worktrail", not
"worktrail over THIS backlog", and `serve-backlog.mjs:506` on that basis exits
with `exit 0` and the message "already running — opening the tab". This is a
silent no-op with a side effect: the user gets an open tab, i.e. a success
signal, and someone else's data. Same class of bug that TL-22 removed from
flag validation.

**This task does not introduce multiple servers at once — those already
work** (`--port`, plus falling back to `port + 1` on `EADDRINUSE` in
`listen()`). Only identity is missing: until the server publishes its own
directory, neither the probe, nor the viewer, nor a future project switcher
has anything to rely on.

That is why this is **a prerequisite for step 6 in TL-36** ("view in the
viewer — project / all switcher"). The shape of that switcher is settled in
TL-36 and is not prejudged here: one server serves one backlog, because the
server WRITES (`.md` writes, history appends, view regeneration), and one
process writing to N repositories divorces state from the branch (Law 1).

Out of scope: a fixed port per project from a registry (that's TL-34) and the
`origin-backlog-*` keys in the viewer's `localStorage`/IndexedDB — those persist
on the user's machine and changing them requires a migration, so they go in a
separate task. `PING_ID` is the one exception here, because it is a handshake
token computed at runtime, not persisted anywhere — changing it costs nothing,
while leaving a literal naming another project breaks the rule "the product
name comes from `scripts/product.mjs`".

## Pre-flight reading

1. `scripts/serve-backlog.mjs` — `PING_ID` (:76), the `/api/ping` handler
   (:342), `probeExisting()` (:435), `listen()` with fallback to the next port
   (:455), the probe before start (:506).
2. `scripts/paths.mjs` — `resolveBacklogDir()`: the four sources of the
   directory and why `cwd` is one of them.
3. `scripts/product.mjs` — where the product name comes from.
4. `scripts/tests/_repo.mjs` — how the tests establish the backlog directory
   in BOTH layouts; the new test should use this rather than counting paths
   upward itself.
5. `scripts/tests/flag-validation.test.mjs` — the pattern for a test that
   starts a command and asserts on its output.

## Steps

1. `/api/ping` returns `{ app, pid, backlogDir, projectName }`. `backlogDir`
   as an **absolute, resolved** path (`realpath`) — otherwise a worktree
   reached through a symlink would compare unequal to the same directory.
2. `probeExisting()` takes the expected directory and returns three states,
   not two: `same` (same backlog), `other` (worktrail, but someone else's
   backlog), `none`. Returning a boolean is what today conflates the first two
   cases.
3. `same` → behaves as today: message and open the tab, `exit 0`.
4. `other` → **do not take over the port**: `listen()` starting from
   `port + 1`, and the message names both projects and both ports. Without
   names the user does not know what is sitting on that port and goes back to
   `ps aux`.
5. `PING_ID` computed from `product.mjs`, not the literal `"origin-backlog-viewer"`.
6. Test `scripts/tests/serve-identity.test.mjs` starts two servers on the same
   starting port over two backlog fixtures and asserts that the second one
   serves ITS OWN backlog on a different port. A positive control is
   mandatory: the test must also cover the `same` case (a second launch over
   the same directory does NOT bring up a second server) — without it, an
   implementation that never recognizes a server as its own would still pass.
7. Cleanup in the test: both processes killed in `finally`, even when the
   assertion fails. A hanging server on 4321 breaks the next run of the suite.

## Acceptance criteria

- [x] `GET /api/ping` returns `backlogDir` (absolute, after `realpath`) and `projectName`. [proof: identity]
- [x] A second `worktrail serve` over a DIFFERENT backlog brings up its own server on the next free port; its page has its own project's `project_name`. [proof: identity]
- [x] The message for this case names both projects and both ports. [proof: identity]
- [x] A second `worktrail serve` over the SAME backlog still only opens a tab and exits with `exit 0` — no second process. [proof: identity]
- [x] `grep origin scripts/serve-backlog.mjs` returns nothing. [proof: no-stale-name]
- [x] `node --test scripts/tests/*.test.mjs` fully green. [proof: no-regression]
- [x] The test does not leave a running process behind, even after a failed assertion. [proof: identity]

## Verification

```bash
# 1. Server identity — expected: pass, including the `same` positive control
node --test scripts/tests/serve-identity.test.mjs

# 2. The other project's name was not left in the code — expected: exit 0 (no matches)
! grep -n 'origin' scripts/serve-backlog.mjs

# 3. The whole suite — expected: pass, no regressions
node --test scripts/tests/*.test.mjs
```

## Notes

- Changing `PING_ID` means a new client will not recognize an **old** running
  server and will move on to the next port. This is correct: the old process
  runs old code and cannot say whose backlog it holds either way.
- Prerequisite for step 6 in TL-36; this was not entered in TL-36's
  `blocked_by`, because that task is primarily blocked by the registry from
  TL-34.

## Log

- 2026-08-31 pending — claude — from the diagnosis "I don't see the TL tasks
  in the browser": a server for another project was sitting on 4321, and the
  `/api/ping` probe does not distinguish someone else's backlog from its own,
  so a second launch would have hit the wrong data either way
