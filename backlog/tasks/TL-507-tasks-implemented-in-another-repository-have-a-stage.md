---
id: TL-507
title: "Tasks implemented in another repository have a stage"
type: task
labels: []
board: main
epic: "Release tracking across environments"
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: [TL-501, TL-503]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: multi-repo-tests
    bash: "node --test scripts/tests/release-multi-repo.test.mjs"
---

## Goal

A task whose commits live in a different repository from its backlog has a stated answer: either the deploy model can read stages from that repository, or the report names the task as unobservable instead of reading it as undeployed or as a done task that never reached the trunk.

## Context

Filed while generalising `docs/release-tracking.md` across product shapes. TL-501 computes the stage a task has reached from the commits of the repository holding the backlog. Projects split across repositories — a separate frontend repository, a desktop client in its own repository — implement tasks whose commits that git never sees. Without a decision, TL-502 lists such a task in no stage and the TL-503 gate reports it as a done task whose commits never reached the trunk, which is a false gap.

Options to weigh, none chosen: a `repository:` key on a deploy target naming a local clone or remote whose refs are fetched read-only; reading the other repository's commits through the `<repo>#<path>` reference form `check --refs` already recognises; or declaring such targets unobservable and excluding their tasks from the gate with an explicit note. Law 1 constrains the choice: the task stays in the backlog's repository, only the evidence of deployment would be read from elsewhere.

**Decided 2026-11-01 by the owner:** implement the third option only. A deploy target may declare that its code lives in another repository; tasks of such a target are reported as unobservable and no gap detector reports them. Reading another repository's refs is deferred and NOT part of this task.

## Steps

1. Record the decision above in docs/release-tracking.md §6 and add the target-level declaration to the `deploy_targets` validator.
2. Implement the chosen behaviour in scripts/environments.mjs and the gap detectors.
3. Add a fixture with two repositories.

## Acceptance criteria

- [ ] A task implemented in another repository is either placed in its stage or named as unobservable, and the gate does not report it as a done task missing from the trunk. [proof: multi-repo-tests]
