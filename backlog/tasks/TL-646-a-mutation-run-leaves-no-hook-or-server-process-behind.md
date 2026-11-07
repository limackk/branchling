---
id: TL-646
title: "A mutation run leaves no hook or server process behind"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-orphans
    bash: "node --test scripts/tests/mutation/no-orphan-processes.test.mjs"
---

## Goal

A mutation run, including one whose test times out or is killed, leaves no process behind. Every git hook and CLI process a test spawns inside the mutation sandbox is gone when the run ends.

## Context

Observed on 2026-11-07. A mutation run started by a supervised loop around 15:35 CET (sandbox /tmp/mutation-run-A5MMLa/sandbox/sandbox-43ZUzo) left six processes alive for more than two and a half hours: `/bin/sh .git/hooks/commit-msg` and `/bin/sh .git/hooks/pre-commit`, both reparented to PID 1, each running `node <sandbox>/scripts/cli.mjs` with NO arguments, each of which ran `node <sandbox>/scripts/serve-backlog.mjs`. Their working directory was a deleted test fixture, /tmp/branchling-commit-message-hook-*. The likely chain: a mutant dropped the subcommand the hook passes, `resolveCommand()` in scripts/cli.mjs maps an empty argv to `serve`, the server never exits, the hook never returns, and killing the test process does not reach git's hook children. Nothing reported it; the processes were found by `pgrep`. scripts/tests/mutation/subprocess-kill.test.mjs proves the run kills its own subprocess, not the grandchildren of a test.

## Steps

1. Reproduce: a fixture hook that runs the CLI with no subcommand, under a test that times out inside a mutation run.
2. Make the code that spawns git or the CLI in tests and in scripts/mutation-run.mjs kill the whole process group on timeout and on exit (detached group plus a negative-pid kill), or bound every spawned hook with a timeout.
3. Test: after such a run, no process whose command line contains the sandbox path is alive.

## Acceptance criteria

- [ ] a timed-out test in a mutation run leaves no hook or server process behind [proof: no-orphans]
