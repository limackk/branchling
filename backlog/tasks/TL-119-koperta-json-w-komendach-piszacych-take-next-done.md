---
id: TL-119
title: "JSON envelope in the writing commands: take, next, handoff, done"
type: code
labels: []
board: main
epic: "CLI surface"
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/json-envelope.test.mjs"
---

## Goal

`take`, `next`, `handoff` and `done` answer `--json` in the same envelope as
the reading commands (`schemaVersion`, `kind`, payload). After this task a
JSON consumer has ONE contract for the whole CLI, not two depending on
whether the command writes.

## Context

TL-72 introduced the envelope (`scripts/json-envelope.mjs`) and switched
`query`, `stats`, `doctor`, `board` and `next-id` over to it. That task's
scope was settled before it started as covering the READING commands, and
was deliberately not expanded mid-flight — hence this task, rather than a
quiet change alongside it.

What is left is exactly the problem the envelope was built for:
`worktrail next --actor agent:claude --json` returns a bare object, so adding
a field to the response (say, a warning about a taken-over lock) requires
changing the root. The README describes this state explicitly — the section
"The `--json` contract" says the writing commands still go without an
envelope — and that sentence is meant to disappear along with this task.

`handoff` (TL-99) JOINED this trio deliberately, even though it was created
after the envelope existed. Reason: if it had gone straight into the
envelope, the four writing commands would answer with two shapes at once —
a `take`/`next` consumer would read one object, a `handoff` consumer another.
One shape today and one change for all four is cheaper than one command
"already correct" and three to catch up. The envelope test guards
completeness through a table of kinds, so adding `handoff` to it is one line.

Note on `done --json`: its payload carries `entries[]` with verification exit
codes and is read by `jq` in the README. The shape change is breaking, and
the package version is still `0.1.0` — we make the change without a
migration path.

## Pre-flight reading

1. `scripts/json-envelope.mjs` — the `KINDS` table and the emptiness rules;
   new kinds are added THERE, not in the emitter.
2. `scripts/take-task.mjs` (`takeJson()`), `scripts/next-task.mjs`,
   `scripts/handoff-task.mjs` (`handoffJson()`), `scripts/done-task.mjs` —
   the four current emitters and their refusal paths
   (`{ ok: false, kind, id, message, details }`), which are also a response.
3. README, section "The `--json` contract" — the kinds table and the
   sentence about writing commands to remove.
4. `scripts/tests/json-envelope.test.mjs` — the `READING` table and the
   positive control; new kinds are meant to enter the same mechanism.

## Steps

1. Assign kinds: `task-take` (shared by `take` and `next` — both return the
   same payload), `verification-run` for `done`, a separate one for
   `handoff` (its payload is three `from`/`to` pairs and a comment, not a
   task to perform). Settle ONE decision: whether a refusal (`ok: false`) is
   the same kind with an `ok` field, or a separate `refusal` kind; record the
   reason in a comment beside `KINDS`.
2. Switch the emitters to `printJson`; none of them build the envelope
   themselves.
3. `next --json` today carries `passedOver` and `considered` — declare them
   in the kind instead of tacking them onto the `take` payload.
4. Update the README (table + removal of the sentence about writing
   commands) and the `jq` examples.
5. Extend `scripts/tests/json-envelope.test.mjs`: the writing kinds enter
   the same table, so the "kind without a command" test keeps guarding
   completeness. Add a REFUSAL case — that is the path most easily left
   without an envelope.

## Acceptance criteria

- [ ] `take`, `next`, `handoff` and `done` with `--json` return an envelope
      with `schemaVersion` and `kind`.
- [ ] A refusal (`ok: false`) is also an envelope, not a bare object.
- [ ] The README no longer contains the sentence about writing commands
      without an envelope.
- [ ] The test covers the writing kinds and the refusal path.
