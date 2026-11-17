---
id: TL-758
title: "No process a contract entry started outlives the entry"
type: task
labels: []
board: main
epic: "Proof core"
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
created: 2026-11-16
updated: 2026-11-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: group-ended
    bash: "node --test scripts/tests/done-entry-process-group.test.mjs"
  - id: consumers-doc
    bash: "grep -q 'strayStopped' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

When a verification entry's shell exits, core ends whatever the entry left running, for `done`, `done --dry-run` and `check --proofs` alike, and the entry's row in the envelope says whether it had to (`strayStopped`). A process an entry leaves in the background never outlives the verdict.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U14). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

`runBashAsync` in scripts/done-task.mjs starts each entry as the leader of a process group of its own on POSIX (`detached`), and stops that group only when the run is interrupted (TL-401). After a normal exit, a process the entry left in the background keeps running, and no caller can reach it: it sits in a group the caller did not create. Checked on 0.4.0 on 2026-11-16: an entry `sleep N >/dev/null 2>&1 & true` passes, and the sleep is still alive after `done --dry-run` returns. The consumer runs the contract once per mutant, so such processes accumulate with every mutant, and its own port can stop them only while a timeout still finds them descending from branchling.

Proposed: on POSIX, when the entry's shell exits, signal the entry's group with SIGTERM and then SIGKILL after a short grace if it still has members, and set `strayStopped: true` on the row; on Windows, where a tree cannot be found once its root has exited, decide between a job object and a documented limit, and make the test state what it asserts on each platform. Whether a contract that leaves a stray behind should fail is a separate decision; this task only ends it and reports it.

## Steps

1. Write scripts/tests/done-entry-process-group.test.mjs red-first: an entry that leaves a background child records its pid; after the dry run the pid is gone and the row says strayStopped; an entry with no background child reports false (the positive control)
2. End the group after a normal exit as after an interrupt, in the one runner done and check --proofs share
3. Add strayStopped to the verification-run rows and document it in docs/external-consumers.md

## Acceptance criteria

- [ ] no process an entry started is alive after the entry's verdict, and the row says when one had to be stopped [proof: group-ended]
- [ ] the external consumer contract documents strayStopped [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
