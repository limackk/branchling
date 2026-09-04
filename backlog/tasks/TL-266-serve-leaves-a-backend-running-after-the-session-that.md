---
id: TL-266
title: "serve leaves a backend running after the session that started it is gone"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-orphan-servers
    bash: "node --test scripts/tests/serve-lifetime.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A `branchling serve` outlives the session that started it only when
somebody asked for that, and the tool can say which servers are running and
stop them. Today five were listening on this machine, three of them
reparented to `launchd`, and nothing in the tool knew.

## Context

Measured on 2026-09-04:

    PID    UPTIME       PPID  LISTENING
    42221  1d 04:27:15  1     127.0.0.1:8791
    45675  1d 04:20:55  1     127.0.0.1:8792
    48112  1d 04:16:15  1     127.0.0.1:4330
    98353  1d 03:51:59  -zsh  127.0.0.1:4321
    34800  1d 01:49:28  -zsh  127.0.0.1:4322
    54318      13:23:34 alive 127.0.0.1:4340

The first three have `ppid=1`: their launching session is gone and the
kernel reparented them. Three of the six were started from a worktree that
no longer exists. None was stopped by anything.

**Why this is P1 and not housekeeping.** `serve` reconciles the tree on a
timer, which makes every one of these a WRITER to `backlog/history/`. TL-185
— a whole-directory `history` run that absorbed ten changes and recorded
none — lists "two `branchling serve` processes running from the MAIN
checkout of this clone, reconciling on their own timer" among the candidate
causes it could not confirm or rule out. That condition was never cleared;
it is now six processes across four trees, and the same class of defect
would look identical if it happened again.

The append-only log is the tool's evidence layer. A writer nobody knows
about, whose actor is whatever that session was called, is the one thing
that layer cannot absorb.

**The tool has no view of this.** `branchling sessions` reconstructs
sessions from the history log and reports nothing about processes. The
state directory holds `locks/`, `mutex/`, `runs/` and `sessions/`, and no
record of a running server. So the only way to find them is `lsof`, and the
only way to stop them is `kill`.

**Not asking for a supervisor.** The fourth law rules out the tool owning
process lifetime in general. What is missing is smaller: a server that
registers itself where the locks already live, removes itself on exit, and
a way to list and stop what is registered — the same shape the lock
directory already has, and for the same reason.

## Steps

1. Register a running `serve` in the state directory beside the locks, keyed
   the way locks are keyed — by `git rev-parse --git-common-dir` — with its
   port, its tree and its pid.
2. Remove the entry on exit, and treat an entry whose pid is gone as stale
   on read, the way a lock already is.
3. Add the two commands that make the register useful: list what is running,
   and stop one. Decide with `branchling decide` whether stopping somebody
   else's server is allowed at all, or only reported.
4. Say in `serve --help` that the process outlives the shell that started it
   if it is backgrounded, since that is what produced all six.

## Acceptance criteria

- [ ] A running server is discoverable through the tool, and its entry
      disappears when it exits, proven by a test that fails against today's
      code. [proof: no-orphan-servers]
- [ ] A server whose process is gone is reported as stale, not as running.
      [proof: no-orphan-servers]
- [ ] Nothing about `serve` itself changes for somebody who starts one in
      the foreground and stops it with a signal. [proof: suite-green]
