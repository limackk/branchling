---
id: TL-513
title: "Deployment commands live under deploy, not release"
type: task
labels: []
board: main
epic: "Release tracking across environments"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-514, TL-515, TL-516]                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: deploy-command
    bash: "node --test scripts/tests/deploy-command.test.mjs scripts/tests/release-status.test.mjs scripts/tests/release-record.test.mjs scripts/tests/release-scope.test.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The deployment commands are `deploy status` and `deploy record`, and `release` means one thing again: returning a claimed task to the queue (`release <ID>`). `deploy status --release <name>` carries the planned-scope comparison; the gate stays `check --release`.

## Context

Decided 2026-11-02 by the owner. TL-502 and TL-506 routed `release status` and `release record` through scripts/release-task.mjs beside the existing `release <ID>`, so the word `release` named two unrelated things — giving a task back and shipping software — while the config key is `deploy_targets`. Neither subcommand has shipped in a published version, so the rename breaks nobody; leaving an alias was rejected for the same reason: an alias for a name nobody ever used only preserves the ambiguity.

Rename the COMMAND WORDS only. The module files (scripts/release-status.mjs, scripts/release-record.mjs), the `--json` envelope kinds (`release-status`, `release-record`), the planned-scope field `release:`, the `releases:` key and `check --release` keep their names: the first are internal, the envelope kinds are a contract callers may already read from tests, and `release:` really is the release a task is planned for. If a kind is renamed after all, the manual's `--json` table and KINDS must agree.

After the change `release status` and `release record` fail as an unknown task id would, with a hint pointing at `deploy`.

## Steps

1. Add a `deploy` command to the command table in scripts/cli.mjs with `status` and `record` subcommands, routed to the existing modules; remove those subcommands from `release`.
2. Make `release status` / `release record` fail with a hint naming `deploy status` / `deploy record`.
3. Update --help, docs/manual.md, docs/release-tracking.md, README and every test that invokes the old words.

## Acceptance criteria

- [ ] `deploy status` and `deploy record` answer as `release status` and `release record` did, `release <ID>` still returns a task, and the old subcommand words fail with a hint naming `deploy`. [proof: deploy-command]
- [ ] No other test or documented invocation still uses the old words. [proof: suite]
