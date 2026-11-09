---
id: TL-665
title: "A timed-out hook test leaves no process behind outside a mutation run"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-hook-orphans
    bash: "node --test scripts/tests/hook-orphans.test.mjs"
---

## Goal

A test in the default suite that runs git through a hook leaves no hook, CLI or server process behind when git times out, outside a mutation run as well as inside one.

## Context

TL-646 contained the processes a mutation run leaves behind: scripts/mutation-contain.mjs runs each test command as a process-group leader and kills what is left in it, and sweepLeftovers() in scripts/mutation-run.mjs kills whatever still names the run's directory. Neither applies to `node --test scripts/tests/*.test.mjs`. The hook tests (scripts/tests/commit-message-shape.test.mjs, whose fixtures are /tmp/branchling-commit-message-hook-*, and scripts/tests/hooks-install.test.mjs) call spawnSync("git", …, { timeout }). On a timeout Node kills git, not the `/bin/sh .git/hooks/<name>` child git started; that child is reparented to PID 1 and keeps running. If a regression makes the hook invoke scripts/cli.mjs with no subcommand, resolveCommand() maps an empty argv to `serve`, the server never exits and the hook never returns, so a red test run on a developer's machine leaves a server and a shell alive until somebody finds them with pgrep. Nothing reports it.

## Steps

1. Reproduce with a fixture hook that runs the CLI with no subcommand under a test whose git call times out, run by plain `node --test`.
2. Bound the hook processes in the shared test helper that runs git (a detached group plus a negative-pid kill on timeout, or a wrapper with its own timeout), so every hook test inherits it rather than each test file deciding.
3. Prove it fails without the change: a process named by the fixture is alive after the test run.

## Acceptance criteria

- [ ] a hook test whose git call times out leaves no hook, CLI or server process alive after `node --test` [proof: no-hook-orphans]
