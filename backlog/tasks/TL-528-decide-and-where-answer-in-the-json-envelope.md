---
id: TL-528
title: decide --json and where --json answer in the JSON envelope
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: envelope
    bash: "node --test scripts/tests/json-envelope.test.mjs scripts/tests/external-consumer-doc.test.mjs"
---

## Goal

`decide --json` and `where --json` answer in the JSON envelope (`schemaVersion` and a declared `kind`), so an external consumer can switch on `kind` for every `--json` answer instead of special-casing two bare objects.

## Context

scripts/decide-task.mjs prints `JSON.stringify(decideJson(result), null, 2)` (around line 477) and `where --json` prints a bare object with `home`, `homeSource`, `config`, `data`; neither carries `schemaVersion` or `kind`, and neither kind is declared in scripts/json-envelope.mjs. docs/external-consumers.md (TL-525) lists both under 'Outside the envelope today' and its writing-commands table marks `decide` as 'none (bare object)'. Moving a bare object into the envelope changes its root shape, so the change has to be stated as such for any consumer already reading it.

## Steps

1. Declare a kind for each in KINDS with its keys and empty values, and register an invocation in KIND_EXERCISE.
2. Emit through printJson in decide-task.mjs and the `where` command.
3. Add the rows to the manual's --json contract table and to docs/external-consumers.md, and remove both from 'Outside the envelope today'.

## Decisions

- **Kind names: `task-decide` and `where`.** `decide` is the answer to `ask`,
  whose kind is `task-ask`, so the pair reads as one family; `where` follows
  the reading kinds named after their command (`stats`, `check`, `plan`).
- **Payload keys are kept as they were.** Moving into the envelope adds
  `schemaVersion` and `kind` at the root; every key a consumer already read
  stays where it was, so the success shape of both commands is additive.
- **The `decide` refusal is the one renamed shape.** It carried the refusal's
  name under `kind` and its sentence under `message`. `kind` is reserved by the
  envelope, so they became `refusalKind` and `refusal` — the names every other
  writing kind uses — rather than a third private spelling. The change is
  stated in docs/external-consumers.md for anyone branching on the old key.
- **Not done:** `new --json` stays outside the envelope; it has no `--json` at
  all, which is a different task from re-shaping an existing answer.

## Acceptance criteria

- [x] Both commands answer in a declared envelope kind, and both documents list it. [proof: envelope]
