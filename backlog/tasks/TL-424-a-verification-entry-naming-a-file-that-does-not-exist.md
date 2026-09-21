---
id: TL-424
title: "A verification entry naming a file that does not exist passes green"
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
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: missing-path-fails
    bash: "node --test scripts/tests/contract-names-a-real-file.test.mjs"
---

## Goal

A task's `verification:` entry that names a test file which does not exist must FAIL, not pass silently. `node --test scripts/tests/does-not-exist.test.mjs` exits 0 and reports the tests of whatever other paths it was given, so the entry proves nothing while looking green.

## Context

Found on 2026-09-21 while taking TL-349, TL-283 and TL-282 in one worktree: ALL THREE had a first verification entry naming a test file that had never been written. Each block was green against an unchanged tree, and `branchling check --contracts` passed them, because that gate asks whether the command names `branchling` or a known foreign program - not whether the paths it hands that program exist. The three contracts were rewritten by hand in those tasks; the gate that let them through was not. This is the whole failure mode a contract exists to prevent: a task can be closed on a run that executed nothing.

## Steps

1. Decide where the gate belongs: `check --contracts` (it already parses every open task's entries) or `done` refusing at the first entry whose command cannot run.
2. For a `node --test <paths>` entry, the paths are readable from the command without executing it. A path that does not exist, relative to the repository root, FAILS the gate and names the task and the entry.
3. Do not attempt this for an arbitrary shell command - a gate that guesses which words in a pipeline are paths would be wrong in both directions. Narrow it to the shapes that can be read with certainty, and say in the refusal which shapes are checked.
4. Add a positive control: a contract whose named file DOES exist passes, and one whose file is created later stops failing.

## Acceptance criteria

- [ ] A `verification:` entry naming a `node --test` path that does not exist fails the gate, and one naming a real path passes. [proof: missing-path-fails]
