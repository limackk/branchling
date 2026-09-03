---
id: TL-72
title: "JSON envelope: a versioned contract instead of a bare array"
type: code
labels: [post-launch]
board: main
epic: "CLI surface"
priority: P1
status: done
owner: agent:claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-global-tool.md
verification:
  - id: envelope-suite
    bash: "node --test scripts/tests/json-envelope.test.mjs"
  - id: query-envelope
    bash: "node scripts/cli.mjs query --status pending --json | node -e \"const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.schemaVersion!==1||d.kind!=='task-list'||!Array.isArray(d.tasks)) process.exit(1)\""
---

## Goal

Every reading command returns `--json` in an envelope with `schemaVersion`
and `kind`, not a raw array. After this task it becomes possible to add a
field to the response (a warning, the directory used, a result count)
without breaking anyone's script.

## Context

Law IV says that `--json` IS our extension API — we have no plugin API, so
the JSON contract is the only surface anyone can build on. Today `query
--json` returns a bare array of objects. A bare array has no room for
metadata: the only way to add anything is to change the root from an array
to an object, which breaks every existing consumer. The longer this stands,
the more expensive this change becomes — hence P1 despite there being no
visible symptom.

The pattern is taken from Backlog.md (MrLesk), which solved the same
problem with the envelope `{ schemaVersion, kind, tasks }` and a
written-down contract: absent fields are `null`, empty collections are
`[]`, adding a field is backward compatible, and removing, renaming, or
changing the meaning of a field requires a new `schemaVersion`.

Decided before starting: the envelope applies to ALL reading commands
(`query`, `stats`, `doctor`, `board`, `next-id`), not only `query` —
otherwise we have two contracts and the user has to remember which is
where. This is a breaking change for `query --json`; the package version is
`0.1.0` and nothing has been published yet, so we do it NOW, with no
migration path and no compatibility flag.

## Pre-flight reading

1. `scripts/query.mjs:205` — the only place today that emits an array.
2. `scripts/doctor.mjs`, `scripts/stats-report.mjs`, `scripts/ui.mjs` — the
   remaining `--json` emitters; check the shape each of them returns today.
3. `docs/branchling-global-tool.md` §3 — the wording of Law IV, so the
   contract is written down where the rationale already lives.

## Steps

1. `scripts/json-envelope.mjs` — a single function `envelope(kind,
   payload)`, one place that knows the version number. No emitter builds
   the envelope itself.
2. Switch every `--json` emitter over to this function; give a `kind` to
   each command (`task-list`, `stats`, `doctor`, `board`, `next-id`).
3. Decide and implement the emptiness rules: an absent scalar = `null`, an
   absent collection = `[]`. Do not omit keys.
4. Write the contract down in the README (the section on `--json`) — what
   we guarantee, what may grow, what requires a new version.
5. `scripts/tests/json-envelope.test.mjs` — for EVERY reading command: it
   parses, has `schemaVersion`, has the right `kind`, the emptiness keys are
   present. The test has to fail differently on an empty backlog than on a
   non-empty one (positive control — a zero sample must not turn it green).

## Acceptance criteria

- [x] Every reading command with `--json` returns an object with
      `schemaVersion` and `kind`. [proof: envelope-suite, query-envelope]
- [x] The version number is in one place in the code, not in every emitter.
      [proof: envelope-suite]
- [x] An absent scalar is `null`, an absent collection is `[]` — never a
      missing key. [proof: envelope-suite]
- [x] README describes every kind the code can emit. [proof: envelope-suite]
- [x] The test covers every emitter and has a positive control. [proof:
      envelope-suite]

## Log

2026-08-31 pending — agent:claude — created from the analysis of Backlog.md
(github.com/MrLesk/Backlog.md), point 1.
