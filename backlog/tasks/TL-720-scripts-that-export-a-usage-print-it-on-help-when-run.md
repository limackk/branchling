---
id: TL-720
title: "Scripts that export a USAGE print it on --help when run directly"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-12
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: direct-help-printed
    bash: "for s in audit docs-drift pr-summary seed-adapter; do node scripts/$s.mjs --help >/dev/null || exit 1; done && node --test scripts/tests/help-exit-lines.test.mjs"
---

## Goal

Every script that exports a USAGE constant either prints it on `--help` when run directly, or stops exporting a help text nothing prints.

## Context

scripts/audit.mjs, scripts/docs-drift.mjs, scripts/pr-summary.mjs and scripts/seed-adapter.mjs each export a USAGE constant that no code prints: run directly with `--help` (for example `node scripts/pr-summary.mjs --help`), each answers `unknown flag: --help`, exits 2, and sends the reader to `branchling <command> --help` instead. Their dispatcher entries in scripts/cli.mjs carry the help that is actually printed. TL-695 added exit lines to the pr-summary and seed-adapter constants and scripts/tests/help-exit-lines.test.mjs now judges all four by importing them, so their exit codes stay in step with the dispatcher, but a person running the script directly still never sees that text. migrate-prefix.mjs, renumber.mjs, query.mjs and doctor.mjs do print their USAGE on `--help`. Decide one rule: either main() of each of the four prints USAGE and exits 0 on `--help`/`-h` (as migrate-prefix.mjs does), or the constant is removed so the dispatcher entry is the only help text; then apply it to all four.

## Steps

1. Decide whether the four scripts print their USAGE on --help or drop the constant
2. Apply the decision to audit.mjs, docs-drift.mjs, pr-summary.mjs and seed-adapter.mjs
3. Make the direct-script test in scripts/tests/help-exit-lines.test.mjs run each script with --help instead of importing its constant, if the constant stays

## Acceptance criteria

- [x] each of the four scripts answers --help with exit 0, and the help-exit-lines test still holds [proof: direct-help-printed]
