---
id: TL-364
title: "The JSON envelope reference covers every emitted kind"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/json-envelope.mjs, scripts/tests/json-envelope.test.mjs, docs/manual.md]
verification:                      # HOW to check the task is really done
  - id: envelope-suite
    bash: "node --test scripts/tests/json-envelope.test.mjs"
---

## Goal

The machine-readable envelope reference lists every JSON `kind` the CLI emits,
so external integrations can depend on documented, complete response shapes.

## Context

The full suite found that the `agent-launches` kind is emitted by code but absent
from the reference table. The contract tests consequently cannot build a
complete command matrix. This is a documentation and contract-drift defect, not
a reason to remove the kind or weaken the test.

## Pre-flight reading

The envelope registry, its exhaustive tests and the public reference must evolve
together.

1. `scripts/json-envelope.mjs` — enumerate the canonical kinds and fields.
2. `scripts/tests/json-envelope.test.mjs` — retain the bidirectional coverage.
3. `docs/manual.md` — add the missing public row and field description.

## Steps

1. Compare emitted kinds with the reference table.
2. Document `agent-launches` with its actual stable fields.
3. Run the envelope contract test.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] Every emitted JSON kind has one reference row. [proof: envelope-suite]
- [ ] The documented fields and command matrix agree with the registry in both
  directions. [proof: envelope-suite]
