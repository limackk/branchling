---
id: TL-638
title: "The import suite kills the mutants surviving in its reporting paths"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: import-tests
    bash: "node --test scripts/tests/import-github.test.mjs"
  - id: dry-run-json-asserted
    bash: "grep -q -- '--dry-run\", \"--json' scripts/tests/import-github.test.mjs"
---

## Goal

The suite for `import --from github` fails when the command's `main()` reporting paths are broken: the `--dry-run --json` envelope, the `ok` and `dryRun` values of a real `--json` run, the `skipped` list, the rebuild warning and the backlog-resolution refusal are each held by an assertion that a mutation run can show kills its mutant.

## Context

A named-only mutation run over `scripts/import-github.mjs` on 2026-11-07 (`node scripts/mutation-run.mjs --named-only --files scripts/import-github.mjs`, run for TL-580) scored 48% with 329 survivors. Most of them sit in `main()` and predate TL-580: `if (opts.json)` inside the dry-run branch can be flipped to false (no test in `scripts/tests/import-github.test.mjs` runs `--dry-run --json`); the `ok: true` and `dryRun: false` literals of the real `--json` envelope can be inverted; `skipped: plan.skipped.map((i) => i.url)` can return undefined; `built.status !== 0` can be flipped; the `answerBacklogDirRefusal` call and the `board` fallback chain can be emptied. The registry exercise in `scripts/json-envelope.mjs` (`KIND_EXERCISE.import`) runs a dry run with `--json`, but only the key set is checked, not the values. TL-580's own lines (the `sourceState` key and the retirement pointer) were killed, apart from whitespace indentation literals, which are equivalent mutants.

## Steps

1. Run `node scripts/mutation-run.mjs --named-only --files scripts/import-github.mjs` and list the survivors in `main()`.
2. For each behaviour that matters, add an assertion to `scripts/tests/import-github.test.mjs` with a fixture, and check that it kills its mutant.
3. Name in the commit body the survivors left as equivalent (indentation, colour wrappers) and why.

## Acceptance criteria

- [ ] The import suite, including the new assertions on the reporting paths of main(), is green. [proof: import-tests]
- [ ] A test runs the dry run with --json and asserts its envelope. [proof: dry-run-json-asserted]
