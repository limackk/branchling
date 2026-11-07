---
id: TL-642
title: "jira-proof reads the repository --dir names from any directory"
type: task
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: jira-proof-tests
    bash: "node --test scripts/tests/jira-proof.test.mjs"
---

## Goal

A test proves that `jira-proof` reads the range in the repository `--dir` names, not in the directory the command was started from.

## Context

The default `git` runner in `scripts/jira-proof.mjs` (function `git`, around line 306) passes `{ cwd, encoding: "utf8", ... }` to `spawnSync`. A mutation run for TL-582 (`npm run mutation -- --named-only --files scripts/jira-proof.mjs`) left the mutant that empties that options object, and the one that empties the `utf8` encoding, alive: every fixture test in `scripts/tests/jira-proof.test.mjs` starts the CLI with its working directory inside the fixture repository, so a runner that ignored `cwd` would still read the right repository. A test that runs `jira-proof --dir <fixture>/backlog --base <sha> --json` from a working directory OUTSIDE the fixture (for example `tmpdir()`), with one Jira-linked task closed in the range, would fail on the empty-options mutant. The two `maxBuffer` mutants on the same line are equivalent here and are not this task's concern. Done when that test exists, passes, and a rerun of the mutation command above no longer lists the empty-options survivor on that line.

## Steps

1. Add a test to scripts/tests/jira-proof.test.mjs that spawns the CLI with cwd outside the fixture and --dir pointing into it, and asserts the closed Jira-linked task is reported.
2. Rerun the mutation command with --named-only on scripts/jira-proof.mjs and confirm the empty-options mutant of the default git runner is killed.

## Acceptance criteria

- [ ] jira-proof reads the repository --dir names when started from another directory [proof: jira-proof-tests]
