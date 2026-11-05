---
id: TL-514
title: "A task joins an external target through its own field"
type: task
labels: []
board: main
epic: "Release tracking across environments"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [TL-513]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: target-field
    bash: "node --test scripts/tests/external-target-field.test.mjs scripts/tests/release-multi-repo.test.mjs"
---

## Goal

A task names the deploy target whose code lives in another repository through its own `target:` field, and the target no longer carries `labels:` for that purpose.

## Context

Decided 2026-11-02 by the owner. TL-507 linked a task to an external target (a target with `repository:`) through the task's labels, with `labels:` required on such a target. The owner chose a dedicated task field instead: a label is a category, and letting it also mean 'this task ships from that repository' gives one value two roles.

`target:` takes a value from the names of the targets declared in `deploy_targets` that carry `repository:` — a closed vocabulary drawn from config, like `board:` from boards.yaml — and is a list, because a task may span two external repositories. It is optional; empty means the task belongs to no external target. A value naming a local target (one with paths) fails: a local target is computed from commit paths, and a hand-typed membership would contradict that computation (Law 2). Remove `labels:` from external targets: an external target that still declares it fails with a message naming `target:` on the task, since nothing has been published that uses it.

Everything TL-507 and TL-512 built on the label match — deploy status's unobservable lane, the gate's exemptions, planned-blocker-open, the viewer's Release view, query --json/--env, show — must read the field instead, through ONE helper so the rule lives in one place.

## Steps

1. Add `target:` to FIELD_SHAPES (scripts/config.mjs), the parser, both templates and `new --target`, with its vocabulary from the external targets in deploy_targets.
2. Replace the label match with one helper in scripts/deploy-targets.mjs or scripts/environments.mjs, and switch every reader to it.
3. Refuse `labels:` on an external target with a hint; update docs/release-tracking.md and docs/manual.md.
4. Rewrite the relevant tests in scripts/tests/release-multi-repo.test.mjs and add scripts/tests/external-target-field.test.mjs.

## Acceptance criteria

- [x] A task joins an external target only through `target:`, an unknown or local target value fails validation, `labels:` on an external target is refused with a hint, and every reader uses the field. [proof: target-field]
