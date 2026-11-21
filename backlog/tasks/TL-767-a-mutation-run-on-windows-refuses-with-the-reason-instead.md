---
id: TL-767
title: "A mutation run on Windows refuses with the reason instead of starting"
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
created: 2026-11-21
updated: 2026-11-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: windows-refusal
    bash: "node --test --test-name-pattern='Windows' scripts/tests/mutation-run.test.mjs"
---

## Goal

`npm run mutation` on Windows refuses at once with a sentence that says why, instead of starting Stryker on a command it cannot run.

## Context

Stryker's command runner starts its command with child_process.exec (node_modules/@stryker-mutator/core/dist/src/test-runner/command-test-runner.js), which is cmd.exe on Windows, while sandboxCommand in scripts/mutation-run.mjs builds POSIX shell: `[ -e .git ] ||`, `ln -s`, `&&` chains, `'…'` quoting. The run also relies on process groups and `ps` for its sweep. A Windows run therefore cannot judge a mutant. The tests of that machinery are skipped on win32 by TL-768, which names this task as the reason. A refusal is the honest behaviour until somebody decides a Windows run is worth building; whether to build one is not this task.

## Steps

1. Refuse in mutation-run.mjs main() on win32 before the slot is taken, naming the POSIX shell, process groups and ps as the reason, exit 2.
2. Say so in --help and in the AGENTS.md mutation section.
3. Test the refusal by simulating the platform, with a positive control that linux is not refused.

## Acceptance criteria

- [ ] a mutation run on Windows refuses before starting anything, and elsewhere it is not refused [proof: windows-refusal]
