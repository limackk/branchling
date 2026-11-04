---
id: TL-546
title: "Backlog resolution refusals exit with one code from every command"
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
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: one-code
    bash: "node --test scripts/tests/not-a-backlog-dir.test.mjs scripts/tests/no-backlog-refusal.test.mjs"
---

## Goal

A directory named with --dir or BACKLOG_DIR that is not a backlog, and no backlog at all, exit with the same code from every command.

## Context

Since TL-545, commands that resolve through resolveBacklogDirOrExit in scripts/paths.mjs (show, query, stats, plan, new, done, resume, log, build, doctor, check and others) exit 1 for both foreseen resolution states: no backlog found (BacklogNotFoundError) and a named directory that is not a backlog (NotABacklogError). Commands that call the bare resolveBacklogDir and refuse in their own shape exit 2 for the same states and label them kind "usage" in their JSON envelope: take-task.mjs, next-task.mjs, set-field.mjs, release-task.mjs, handoff-task.mjs, ask-task.mjs, decide-task.mjs, declare-vocabulary.mjs, release-record.mjs, release-status.mjs and others found by `grep -n 'resolveBacklogDir(' scripts/*.mjs`. A script testing $? therefore depends on which command it ran. Many of those catch blocks also catch every error, so a programmer error is reported as a usage refusal instead of showing its stack; isBacklogDirRefusal() in scripts/paths.mjs is the predicate to narrow them with. Moving the code from 2 to 1 changes the external contract: docs/external-consumers.md and docs/manual.md must say which exit code and which envelope kind this state carries, and consumers such as a UI that maps exit codes must be able to rely on it.

## Steps

1. List every command that resolves the backlog directory without resolveBacklogDirOrExit and record its current exit code and envelope kind for both states
2. Decide the single code and envelope kind for the two states, and record the decision in docs/external-consumers.md
3. Narrow each catch to isBacklogDirRefusal(e) and return the decided code
4. Move the DIRECT_CASES in scripts/tests/not-a-backlog-dir.test.mjs to the exact-code assertion

## Acceptance criteria

- [ ] Every command exits with the same code for no backlog and for a named directory that is not a backlog. [proof: one-code]
