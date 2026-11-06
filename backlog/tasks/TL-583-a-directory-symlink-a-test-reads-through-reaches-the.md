---
id: TL-583
title: "A directory symlink a test reads through reaches the mutation sandbox"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: symlink-in-sandbox
    bash: "node --test scripts/tests/mutation/subprocess-kill.test.mjs"
  - id: scope-unchanged
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

A mutation run's sandbox carries every directory symlink of the tree, so a test that reads through one passes in the dry run as it does in the working tree.

## Context

StrykerJS copies the tree into a sandbox file by file and fails with `ENOTSUP copyfile` on a symbolic link to a directory. This repository tracks four (`.claude/skills/*` -> `../../.agents/skills/*`, git mode 120000). TL-576 avoided the crash with `ignorePatterns: [".claude"]` in `runStryker()` in `scripts/mutation-run.mjs`, which removes the whole directory from the sandbox.

Measured on 2026-11-06: `npm run mutation -- --named-only --files scripts/task-id.mjs` stopped in Stryker's initial test run, because `scripts/tests/instructions.test.mjs:373` reads `.claude/skills/backlog-workflow/SKILL.md` through one of those links and found it missing. Stryker refuses to mutate when the dry run is red, so no score was produced. The TL-576 spike used three test files, none of which reads through a link, so the defect did not show there.

The fix ignores exactly the directory symlinks found in the tree (not their parent directory) and recreates each one, with its own relative target, in the sandbox before the test command runs. The command runner runs its command in the sandbox through a shell, which is where that can happen without a Stryker plugin.

## Steps

1. Find directory symlinks in the tree, skipping node_modules and .git
2. Ignore exactly those paths and recreate them in the command runner's command
3. Add a Stryker-running test whose fixture reads through a directory symlink
4. Rerun the task-id named-only pass to see the dry run go green

## Acceptance criteria

- [x] A test that reads a file through a directory symlink passes inside the mutation sandbox, and the run still counts kills made through a spawned process [proof: symlink-in-sandbox]
- [x] Scope and test selection behave as before the change [proof: scope-unchanged]
