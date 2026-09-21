---
id: TL-425
title: "import --json crashes instead of answering"
type: task
labels: []
board: main
epic: "CLI onboarding"
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/import-github.mjs, scripts/json-envelope.mjs, docs/manual.md]
verification:                      # HOW to check the task is really done
  # Both entries run against THIS repository, so neither can pass on an empty
  # sample: the first is the crash itself, the second is the registration the
  # manual names as the only place a kind is declared.
  - id: import-answers-json
    bash: "echo '[]' | node scripts/cli.mjs import --from github --dry-run --json | head -c 200"
  - id: envelope-suite
    bash: "node --test scripts/tests/json-envelope.test.mjs scripts/tests/docs-terminal-surface.test.mjs"
---

## Goal

`branchling import --from github --dry-run --json` answers in the standard
envelope instead of throwing, and the `import` kind is declared where every
other kind is declared.

## Context

Found while TL-342 was comparing the documents against the terminal.
`docs/manual.md` lists a row for the `import` kind in the `--json` contract
table, and `scripts/import-github.mjs` calls `printJson()` with that kind — but
`KINDS` in `scripts/json-envelope.mjs` does not declare it, so the call throws:

    Error: unknown JSON kind: import (declare it in json-envelope.mjs; ...)

That is an unhandled exception with a stack trace, not a refusal: `--json` on
this command has never worked. Nothing caught it because
`scripts/tests/json-envelope.test.mjs` walks `KINDS` and can only exercise what
is declared there, and the manual's row for a kind nothing emits was invisible
in that direction.

TL-342 did not fix it: a crashing command is a defect of its own with its own
verification, not a documentation drift. Its guard
(`scripts/tests/docs-terminal-surface.test.mjs`) names this id in the exemption
map `UNSETTLED_KINDS` and FAILS once the defect is gone, so the exemption
cannot outlive it.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/json-envelope.mjs` — `KINDS` and `KIND_EXERCISE`: the manual states
   that registering a kind happens here and nowhere else.
2. `scripts/import-github.mjs` — what it actually passes to `printJson()`, and
   which keys the answer carries on a dry run and on a write.
3. `docs/manual.md` — the `--json` contract table: the row that already
   promises `ok`, `root`, `dryRun`, `created`, `skipped`, `droppedLabels`,
   `withoutVerification`, `errors`.
4. `scripts/tests/docs-terminal-surface.test.mjs` — the exemption to remove.

## Steps

1. Declare `import` in `KINDS` with the keys the command emits, and its
   invocation in `KIND_EXERCISE`, reading issues from stdin.
2. Reconcile the emitted keys with the manual's row, in whichever direction is
   true — the suite compares both.
3. Remove the `TL-425` entry from `UNSETTLED_KINDS` in
   `scripts/tests/docs-terminal-surface.test.mjs`; that file fails while an
   exemption names a defect that no longer exists.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] `import --from github --dry-run --json` exits 0 and prints one envelope
      rather than a stack trace. [proof: import-answers-json]
- [ ] `import` is declared in `KINDS` and exercised by `KIND_EXERCISE`, and the
      manual's row agrees with it in both directions.
      [proof: envelope-suite]
- [ ] The documentation guard passes with no exemption for this kind.
      [proof: envelope-suite]
