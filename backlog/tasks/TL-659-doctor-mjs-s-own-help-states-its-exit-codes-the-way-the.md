---
id: TL-659
title: "doctor.mjs's own help states its exit codes the way the dispatcher help does"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: doctor-direct-help
    bash: "node --test scripts/tests/help-exit-lines.test.mjs && node scripts/doctor.mjs --help | grep -q \"1 no backlog, or a directory named that is not one\""
---

## Goal

`node scripts/doctor.mjs --help` prints an exit line that agrees with `branchling doctor --help`: 0 no errors, 1 there is an error, 2 usage error, and the no-backlog clause.

## Context

TL-572 gave the `doctor` entry of the COMMANDS table in scripts/cli.mjs an exit line ending with NO_BACKLOG_EXIT_LINE. The script's own USAGE constant in scripts/doctor.mjs (printed when the script is run directly, never through the dispatcher) still says `exit code: 0 = no errors (warnings allowed), 1 = there is an error`, omitting 2 (unknown flag, returned by main) and the no-backlog case. Two help texts for one command now disagree. scripts/tests/help-exit-lines.test.mjs already checks the directly-printed help of audit.mjs, docs-drift.mjs, renumber.mjs and query.mjs for the clause; doctor.mjs is not in that list. Other scripts whose own USAGE carries an exit description may have the same drift and are worth one look while there.

## Steps

1. Rewrite the exit line of USAGE in scripts/doctor.mjs to list 2 and end with BACKLOG_DIR_REFUSAL_HELP from scripts/paths.mjs
2. Add doctor.mjs to the direct-script help check in scripts/tests/help-exit-lines.test.mjs

## Acceptance criteria

- [x] doctor.mjs run directly prints an exit line that lists 2 and names the no-backlog code [proof: doctor-direct-help]
