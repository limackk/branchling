---
id: TL-567
title: "hooks and skills install answer --json in the shared envelope"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: envelope
    bash: "node --test scripts/tests/json-envelope.test.mjs scripts/tests/json-kind-registry.test.mjs"
  - id: no-backlog
    bash: "node --test scripts/tests/json-no-backlog-envelope.test.mjs"
---

## Goal

`hooks print|install|uninstall --json` and `skills install --json` answer in the shared JSON envelope, with a declared kind in scripts/json-envelope.mjs and a KIND_EXERCISE row, so a consumer can switch on `kind` and `ok` as it does for every other command.

## Context

scripts/hooks-command.mjs (around lines 168, 222 and 271) and scripts/install-skills.mjs (around line 176) print bare objects with `console.log(JSON.stringify(...))`: no `schemaVersion`, no `kind`, no `ok`. The fourth law makes `--json` the extension surface, and TL-72 put every other command into one envelope. TL-548 left these two out of its no-backlog sweep for exactly this reason: `skills install --json` run where there is no backlog still prints its refusal on stderr with stdout empty, because there is no kind to answer it in. scripts/tests/json-no-backlog-envelope.test.mjs lists both commands in its exemptions with a pointer to this task; remove them from there when this is done.

## Steps

1. Declare a kind for each answer (hooks and skills install) in KINDS and register its invocation in KIND_EXERCISE
2. Print each answer through printJson instead of a bare JSON.stringify
3. Answer the no-backlog state of `skills install --json` with answerBacklogDirRefusal from scripts/paths.mjs
4. Drop both commands from the exemptions in scripts/tests/json-no-backlog-envelope.test.mjs and document the kinds in docs/external-consumers.md

## Acceptance criteria

- [ ] Every declared kind, including the new ones, is exercised and complete. [proof: envelope]
- [ ] The no-backlog sweep covers both commands with no exemption. [proof: no-backlog]
