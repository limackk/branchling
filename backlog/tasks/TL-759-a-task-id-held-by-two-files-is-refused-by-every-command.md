---
id: TL-759
title: "A task id held by two files is refused by every command that names it"
type: task
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
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-18
updated: 2026-11-18
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: duplicate-id-refused
    bash: "node --test scripts/tests/duplicate-id-refusal.test.mjs"
  - id: consumers-doc
    bash: "grep -q 'duplicate-id' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

When two or more files under tasks/ hold one task id, every command that reads, runs or writes that one task answers from no file at all: under --json it refuses with its own envelope kind, ok: false, refusalKind "duplicate-id", a refusal sentence and a key `files` listing the files that hold the id (paths relative to the backlog, sorted), exit 1, and nothing is run or written. Today show answers from one of those files and done and take act on the other, all with ok: true, so a consumer cannot tell from show which contract done will run, and a take can leave show reporting the task as still pending.

## Context

Filed on 2026-11-18 from the branchling-proof workspace (its task PF-48; its architecture section 13 lists this capability as U16). That product reaches branchling only through --json envelopes, and its history audit (PF-22) compares every entry a done --dry-run reports with the contract show answered, reporting the task inconclusive when they differ, because the two can come from different files. That guard stays there; what is missing is core giving one answer. The shape below is a proposal, to be settled with the maintainer before the work starts.

Reproduced on 0.4.0, 2026-11-18, in a fixture backlog made by init and new, then the task file copied under a second name (TASK-1-fixture-task.md with `bash: "echo from-A"`, TASK-1-zz-renamed.md with `bash: "echo from-Z"`), committed:
- `show TASK-1 --json`: ok: true, file tasks/TASK-1-zz-renamed.md, the entry `echo from-Z` (the name that sorts last).
- `done TASK-1 --dry-run --json`: verification-run, ok: true, refusalKind null, ran `echo from-A` (the name that sorts first), wouldBe done.
- `take TASK-1 --json`: task-take, ok: true, wrote tasks/TASK-1-fixture-task.md; a `show` afterwards still answered status pending from the other file.
- `query --json`: task-list with two rows for TASK-1, each with its own `file`. That is a correct description of the store and stays as it is.
- `check --json`: ok: false, exit 1, the gate guard `id-collisions` failed with "ID COLLISION TASK-1: TASK-1-fixture-task.md + TASK-1-zz-renamed.md" in its text output. So check already reports the collision; the reads and writes that name the id do not consult it.

The state is not only a hand-made mistake: a consumer that runs a contract against a base tree made from an older commit plus the task's file at a newer one gets two files for one id whenever the task's file was renamed between the two commits.

Alternatives considered: answering from one deterministic file (for example the one that sorts first) in every command would make the answers agree, but it would still let done prove a task from a contract nobody chose, and nothing in the envelope would say a second file exists; refusing names the problem where it can be fixed, as check already does. The refusal does not apply to query, check, build, stats or the other commands that read the whole store without naming the id. The proposed refusalKind name and the key `files` are open to the maintainer; what is asked is one refusal, the same in every command.

## Steps

1. Write scripts/tests/duplicate-id-refusal.test.mjs red-first over a fixture backlog that holds one id in two files with different contracts: show, done --dry-run, done, take, set, body, release, handoff, ask, decide, log and resume, each with --json, answer their own kind with ok: false, refusalKind duplicate-id, `files` naming both files, exit 1; done --dry-run runs neither entry, and no file or history changes. Positive control: the same calls on the same id after the second file is removed answer ok: true
2. Resolve a task by id in one place that refuses when the store holds more than one file for it, and route every single-task command through it
3. Without --json the same commands print the refusal sentence naming the files on stderr and exit 1
4. Add the duplicate-id row to 'When a reading command refuses' in docs/external-consumers.md and say which commands carry it

## Acceptance criteria

- [ ] every command that names one task refuses with duplicate-id, the files listed and nothing run or written, when two files hold the id; the same calls succeed on one file [proof: duplicate-id-refused]
- [ ] the external consumer contract documents the duplicate-id refusal [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
