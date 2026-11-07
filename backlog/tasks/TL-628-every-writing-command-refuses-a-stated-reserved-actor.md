---
id: TL-628
title: "Every writing command refuses a stated reserved actor unknown"
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
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: writers-refuse-stated-unknown-actor
    bash: "node --test scripts/tests/writers-reserved-actor.test.mjs"
---

## Goal

Every writing command other than a field write refuses the reserved actor `unknown` when it is STATED (by `--actor`, `BACKLOG_ACTOR` or the user configuration), so no command can record an act the tool performed as one nobody performed.

## Context

`unknown` is reserved for a change that was OBSERVED, not made by the tool (AGENTS.md, TL-105); it must never be typed by hand. `isValidActor()` in scripts/task-fields.mjs accepts it on purpose, because `reconcile()` and history readers need it as a value, and `actorRefusal()` returns null for it. TL-569 closed this hole for field writes only: `writeTaskField()` in scripts/field-write.mjs refuses `unknown`, so `set` and the served viewer's POST /api/task are covered. Every other writer still gates on `isValidActor()` / `actorRefusal()` and accepts it. Measured on 2026-11-07 in a fresh `init` fixture: `branchling take <ID> --actor unknown` exits 0, writes `owner: unknown` into the task and appends history rows with `actor: unknown`, `source: take`, `reason: unknown` — a deliberate claim filed as an unattributed observed change, which `isUnattributed()` in scripts/history.mjs then counts as one. The writers that import `actorRefusal` or `isValidActor` are: take-task, next-task, run-loop, handoff-task, release-task, resume-task, done-task, ask-task, decide-task, body-task, new-task, history-record, release-record, renumber, migrate-prefix, seed-backlog, import-github, agent-profiles. Care is needed: `reconcile()` (serve-backlog.mjs, history.mjs) and any record written with `source: external` or `boot` legitimately use `unknown`, and seed/import paths may write it for rows that really were observed — the refusal belongs to a STATED actor of a command's own act, not to the value in history. The likely shape is one helper beside `actorRefusal()` (for example a `statedActorRefusal()` that adds the reserved case, reusing the wording TL-569 put in field-write.mjs) called by each writer, with `isValidActor()` left accepting `unknown`.

## Steps

1. List which writers record an act of their own under the resolved actor, and which legitimately write `unknown` for an observed change (reconcile, external/boot sources); leave the second group alone
2. Add one shared refusal for a stated reserved actor beside `actorRefusal()` in scripts/task-fields.mjs and move the TL-569 check in scripts/field-write.mjs onto it
3. Call it from every writer in the first group before anything is written
4. Test take, next and handoff at least through the CLI: `--actor unknown` exits with a refusal and writes nothing; a namespaced actor still writes; `isValidActor('unknown')` stays true

## Acceptance criteria

- [ ] `take`, `next` and `handoff` refuse a stated actor `unknown` and write nothing, while a namespaced actor still writes and history readers still accept `unknown`. [proof: writers-refuse-stated-unknown-actor]
