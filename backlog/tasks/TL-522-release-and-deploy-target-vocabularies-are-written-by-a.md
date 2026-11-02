---
id: TL-522
title: "Release and deploy-target vocabularies are written by a command"
type: task
labels: []
board: main
epic: "External UI contract"
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
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: release-vocab-write
    bash: "node --test scripts/tests/release-vocabulary-write.test.mjs"
---

## Goal

Declaring a release or a deploy target is one command that edits config.yaml in place, keeps its comments, validates the shape and records why, so release management does not require hand-editing configuration.

## Context

The `releases:` and `deploy_targets` vocabularies in backlog/config.yaml are read by new, query, deploy status and check --release, but no command writes them: `grep` over scripts/ finds no writer of `releases` other than init-backlog.mjs, which writes the initial file. A release-management interface built on the CLI contract (for example a separate branchling-ui package) can plan tasks for a release but cannot create the release. Before implementing, decide and record whether a vocabulary write belongs in the tool at all under the third law (configuration layers are disjoint; the code knows the shape, config.yaml knows the values): the answer may be a narrow command for these two keys only, not a general config editor.

## Steps

1. Record the decision on the scope of a configuration write, naming the keys it covers and why the rest stay hand-edited.
2. If accepted, add the command (for example `branchling releases add <name> --reason "..."` and a matching deploy-target form) that preserves comments and ordering in config.yaml the way `plan add` preserves plan.yaml.
3. Refuse a duplicate name, a malformed target, and any key outside the decided set; emit a declared envelope kind with --json.
4. Document the command in docs/release-tracking.md.

## Acceptance criteria

- [ ] Adding a release to a fixture config.yaml keeps every comment, makes `new --release <name>` accept it, and a duplicate or an undeclared key is refused without writing. [proof: release-vocab-write]
