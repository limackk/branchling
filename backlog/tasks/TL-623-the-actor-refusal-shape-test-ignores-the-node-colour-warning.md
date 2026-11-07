---
id: TL-623
title: "The actor refusal shape test ignores the Node colour warning"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: actor-shape-old-node
    bash: "node --test scripts/tests/actor-shape-diagnosis.test.mjs"
---

## Goal

scripts/tests/actor-shape-diagnosis.test.mjs passes on every Node line in the CI matrix, because its line count of a refusal ignores warnings Node itself prints on stderr.

## Context

Observed on 2026-11-07 in the test workflow run 42343069037 on main 048929c: the jobs ubuntu-latest and macos-latest on Node 18 and Node 20 fail one test, 'every writing command refuses a wrong name for the name, and a missing namespace for the namespace' (scripts/tests/actor-shape-diagnosis.test.mjs:224, the assertion at :242). The refusal text is correct; the assertion `body.length === 2` gets 4 because Node 18 and 20 print `(node:<pid>) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.` and `(Use \`node --trace-warnings ...\` to show where the warning was created)` on stderr when both variables are set. Node 22 and 24 do not print it, so the suite is green locally and on Node 22. package.json declares engines node >=18 and docs/releasing.md requires the test workflow green on every job before a tag, so this blocks the next release. Two shapes are possible: the test stops setting both NO_COLOR and FORCE_COLOR for the child, or the line count drops lines that start with `(node:` and the trace-warnings hint. The first is preferable if the test does not need FORCE_COLOR, because it keeps the count strict.

## Steps

1. Find where the child environment of this test gets both NO_COLOR and FORCE_COLOR (the test itself, a shared helper, or the CI environment) and remove the conflict, or filter Node's own warning lines from the count
2. Check that no other test counting stderr lines has the same dependence (grep for `lines.length` and `.split("\n")` beside a spawn in scripts/tests)
3. Prove it on Node 18 or 20 locally (for example with npx node@18) or on a CI run of the branch

## Acceptance criteria

- [ ] the actor refusal shape test passes, including on a Node line that prints the NO_COLOR warning [proof: actor-shape-old-node]
