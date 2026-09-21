---
id: TL-266
title: "serve leaves a backend running after the session that started it is gone"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  # REWRITTEN while closing (TL-260, TL-424). `no-orphan-servers` named
  # `scripts/tests/serve-lifetime.test.mjs`, which did not exist — the contract
  # could not run, and the same entry under a shell glob matching nothing would
  # have exited 0 and read as green. `suite-green` was, and still is, an entry
  # that passes against an UNCHANGED tree; it is kept deliberately, because this
  # task starts real servers in the suite and a leaked listener breaks other
  # files rather than its own — but it is no longer the only evidence. The two
  # entries added below both FAIL against the tree as it stood before this
  # change (measured: 6 of 7 cases red, and `serve --help` carrying no such
  # sentence). Every path was checked with `test -f` and every command run.
  - id: no-orphan-servers
    bash: "node --test scripts/tests/serve-lifetime.test.mjs"
  - id: help-says-it-outlives-the-shell
    bash: "node scripts/cli.mjs serve --help | grep -qi 'does NOT stop when the shell that started it'"
  - id: command-surface
    bash: "node --test scripts/tests/help-covers-flags.test.mjs scripts/tests/json-kind-registry.test.mjs scripts/tests/cli-help.test.mjs scripts/tests/cli.test.mjs scripts/tests/flag-validation.test.mjs"
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
   and stop one. WHO MAY BE STOPPED was settled in the code rather than by a
   question, because the safe rule needs no judgement: `--stop` signals a pid
   only when the PORT answers the `/api/ping` handshake as this tool's viewer
   AND names the pid the register recorded. A register is per-user state, so
   another account's servers are already out of reach; an entry from another
   host is reported and never acted on; and a recycled pid — the one way this
   could kill a stranger's process — is refused rather than guessed.
4. Say in `serve --help` that the process outlives the shell that started it
   if it is backgrounded, since that is what produced all six.

## Acceptance criteria

- [x] A running server is discoverable through the tool — `serve --list` and
      `serve --list --json` name its port, pid and tree — and its entry
      disappears when it exits normally or on SIGINT, SIGTERM or SIGHUP.
      [proof: no-orphan-servers]
- [x] A server whose process is gone is reported as `stale`, never as
      `running`, and the next `serve` reclaims the entry. That is the honest
      form of the promise: SIGKILL runs no handler, so no entry can be removed
      by the process it belongs to. [proof: no-orphan-servers]
- [x] `serve --stop` signals NOTHING unless the port answers as this tool's
      viewer with the pid the register recorded: an innocent process registered
      against a foreign listener survives, and the command exits non-zero so a
      script can tell. [proof: no-orphan-servers]
- [x] Nothing about `serve` itself changes for somebody who starts one in
      the foreground and stops it with a signal: Ctrl-C still exits 0, and the
      viewer answers while it is registered.
      [proof: no-orphan-servers, suite-green]
- [x] `serve --help` says the process outlives the shell that started it —
      the condition that produced all six orphans.
      [proof: help-says-it-outlives-the-shell]
- [x] The two new JSON kinds are registered and exercised, the flag surface
      still matches the help, and the rest of the suite is unchanged.
      [proof: command-surface, suite-green]
