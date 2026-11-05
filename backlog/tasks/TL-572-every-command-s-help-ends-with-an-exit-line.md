---
id: TL-572
title: "Every command's --help ends with an exit line"
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
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: help-exit-lines
    bash: "node --test scripts/tests/help-exit-lines.test.mjs"
---

## Goal

Every command in the COMMANDS table of scripts/cli.mjs prints an `exit:` line at the end of its `--help`, so a reader can learn its exit codes, including the no-backlog code, without reading the source.

## Context

TL-549 made every help `exit:` line that lists 2 also name `1 no backlog, or a directory named that is not one` (the constant BACKLOG_DIR_REFUSAL_HELP in scripts/paths.mjs), and scripts/tests/help-exit-lines.test.mjs guards exactly that set. Fourteen commands print no `exit:` line through the dispatcher at all, so the guard cannot ask anything of them: serve, build, viewer, next-id, board, new, pr-summary, init, doctor, check, done, migrate-prefix, mcp and regen-hook. docs/external-consumers.md says each command's `--help` ends with its own `exit:` line, which is not true for these. Some of them have an exit description only in the script's own help (doctor.mjs USAGE `exit code: 0 = no errors…`), which `<command> --help` through the dispatcher never prints, because cli.mjs answers `--help` from the COMMANDS usage. `query` was on this list when it was filed; TL-559 gave its COMMANDS entry an exit line, and the merge of TL-549 appended the no-backlog clause to it.

## Steps

1. For each listed command, establish its real exit codes from its script (process.exit and returned codes)
2. Add an `exit:` line to its COMMANDS usage, ending with NO_BACKLOG_EXIT_LINE where the command resolves a backlog
3. Extend scripts/tests/help-exit-lines.test.mjs so a COMMANDS entry without an exit line fails

## Acceptance criteria

- [ ] every command's --help ends with an exit line, and each one that resolves a backlog names the no-backlog code [proof: help-exit-lines]
