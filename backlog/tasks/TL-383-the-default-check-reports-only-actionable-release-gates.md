---
id: TL-383
title: "The default check reports only actionable release gates"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-21
blocked_by: [TL-377]
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
  - scripts/cli.mjs
  - scripts/audit.mjs
verification:
  - id: concise-check
    bash: "node --test scripts/tests/check-default-signal.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The default `check` is a short release gate: every reported problem is current,
actionable and capable of failing the command. Historical gaps, advisory
quality findings and legacy drift move to an explicit `audit` report.

## Context

The current default check exits zero while printing a wall of warnings about
open task contracts, old reasons, stale legacy log prose and plan caveats. A
green command that trains readers to ignore most of its output weakens the
evidence boundary. Strictness remains valuable only when the default verdict is
clear.

Keep structural release gates such as ids, boards, references, task-state
integrity, executable plan, tracked history and source/product guards. Move
findings that cannot be repaired now or deliberately do not fail to `audit`.
Focused selectors remain available when a caller explicitly asks a narrower
question.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. The `check` command table in `scripts/cli.mjs` — classify every default
   selector by whether it can block release.
2. `scripts/audit.mjs` — receive advisory and historical findings without
   losing them.
3. `backlog/config.yaml` — remove policies that only tune warning volume rather
   than product correctness.
4. Existing check tests — preserve positive controls for every retained gate.

## Steps

1. Define the minimal set of default failing gates and record why each protects
   authorization, scope, proof or distributable source.
2. Move non-failing historical and advisory output to `audit`.
3. Make success output bounded and failure output identify the first actionable
   remedy without hiding the remaining failures in JSON.
4. Keep `--json` verdicts and exit codes consistent with human output.
5. Add positive controls for a clean tree, one failing gate and an audit-only
   historical finding.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A clean default check emits a bounded success report with no warnings.
      [proof: concise-check]
- [x] Every default finding makes the exit code non-zero and names a current
      repair. [proof: concise-check]
- [x] Historical and advisory findings remain available through `audit` and do
      not contaminate the release verdict. [proof: concise-check]
- [x] Human and JSON modes agree on which gate failed and on the exit code.
      [proof: concise-check]
- [x] The complete remaining suite passes. [proof: suite-green]
