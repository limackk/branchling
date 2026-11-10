---
id: TL-695
title: "Scripts run directly print the exit line their dispatcher help prints"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: direct-help-exit-lines
    bash: "node --test scripts/tests/help-exit-lines.test.mjs && node scripts/migrate-prefix.mjs --help | grep -q 'exit'"
---

## Goal

Every script whose own USAGE is printed when it is run directly (migrate-prefix.mjs, pr-summary.mjs, seed-adapter.mjs) ends that help with an exit line listing 2 and the no-backlog clause, agreeing with its dispatcher entry in scripts/cli.mjs.

## Context

TL-572 made every entry of the COMMANDS table in scripts/cli.mjs end its help with an exit line, and TL-549 added the no-backlog clause (BACKLOG_DIR_REFUSAL_HELP from scripts/paths.mjs). The USAGE a script prints when it is run directly, outside the dispatcher, was not part of either. TL-659 aligned doctor.mjs, and audit.mjs, docs-drift.mjs, renumber.mjs, query.mjs and doctor.mjs are now checked by the direct-script test in scripts/tests/help-exit-lines.test.mjs. A survey made during TL-659 found three more scripts with a USAGE constant that states no exit codes at all: scripts/migrate-prefix.mjs (printed on --help and on its usage refusals), scripts/pr-summary.mjs and scripts/seed-adapter.mjs (both export USAGE). A reader running one of them directly cannot learn its exit codes, and the two help texts for one command disagree. Before changing each, confirm whether the script really resolves a backlog (seed-adapter may not, which would make it an exemption like those in EXEMPT in that test) and what its main returns on an unknown flag.

## Steps

1. For each of migrate-prefix.mjs, pr-summary.mjs and seed-adapter.mjs, read the exit codes its main returns and its dispatcher entry's exit line in scripts/cli.mjs
2. Add the matching exit line, ending with BACKLOG_DIR_REFUSAL_HELP where the script resolves a backlog
3. Add each script to the direct-script help check in scripts/tests/help-exit-lines.test.mjs, or name it as an exemption with the reason

## Acceptance criteria

- [ ] the directly printed help of migrate-prefix.mjs, pr-summary.mjs and seed-adapter.mjs states its exit codes and is guarded by the help-exit-lines test [proof: direct-help-exit-lines]
