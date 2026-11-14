---
id: TL-740
title: "A contained command that is not a group leader fails fast"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-14
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: contain-group-leader
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

A mutant that empties the spawn options in scripts/mutation-contain.mjs is Killed by an assertion, not reported as a Timeout.

## Context

Observed on 2026-11-13 while proving TL-732. The changed-lines mutation run over scripts/mutation-contain.mjs reported the ObjectLiteral mutant on the `spawn(command, args, { stdio: ..., detached: processTreeDetached() })` line of contain() as a Timeout. The mutant drops `detached`, so the contained command does not lead its own process group; in scripts/tests/hook-orphans.test.mjs a hook's server (cli.mjs / serve-backlog.mjs) is then orphaned and the test waits until Stryker's timeout, and the run killed two such leftovers at the end. It also drops `stdio`, so the child's output goes to pipes nobody reads. This is a real hang, not an overloaded machine, so the run's 'lower --concurrency' advice for a Timeout is wrong for it. A Timeout counts as detected, so the score is unaffected; what is lost is a full Stryker timeout of wall time per run and the run's ability to tell a hung mutant from a slow machine.

## Steps

1. Find which assertion should notice that the contained command is not a group leader (for example a test that checks the child's pgid equals its pid on a platform where processTreeDetached() is true) and why hook-orphans.test.mjs waits instead of failing
2. Add a bounded assertion so the missing `detached` fails within seconds
3. Rerun `npm run mutation -- --named-only --changed-lines --files scripts/mutation-contain.mjs` (or with the line touched) and confirm the ObjectLiteral mutant comes out Killed

## Acceptance criteria

- [x] a contained command that does not lead its own process group fails an assertion within seconds [proof: contain-group-leader]
