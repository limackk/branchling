---
id: TL-753
title: "check verifies that history is append-only across a range"
type: task
labels: []
board: main
epic: "Proof core"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-16
updated: 2026-11-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: append-only
    bash: "node --test scripts/tests/history-append-only.test.mjs"
  - id: help-names-selector
    bash: "node scripts/cli.mjs check --help | grep -q -- '--append-only'"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`check --append-only --since <rev> [--until <rev>] [--json]` fails when a history record present at a commit of the range is missing or changed at a later one, and names the log, the record and the commit. A consumer can then state that the ledger it cites was not rewritten, without reading history files itself.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U9). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

The ledger is append-only by the convention of the writing commands, but a hand edit to history/<ID>.jsonl is a commit like any other. A consumer may not read history files (its boundary rule), so it cannot check the property, and its evidence pack would otherwise cite a ledger nobody showed to be intact.

Proposed rule: for every commit C in <since>..<until> (until defaults to HEAD) and every parent P of C, every record of every history log at P is present, byte for byte, in the same log at C. Comparing each parent with its child handles merges, where two branches each appended to one log, and finds a rewrite that a later commit undid. A log removed at C fails, except where `migrate-prefix` or `renumber` moved it, which the task recognises from the records those commands write.

With --json the guard's entry in the `check` envelope carries `findings: [{log, recordId, change: removed | changed | log-removed, commit}]` as data, because the guard's text output is not for programs. It runs only when selected, since it needs a range.

## Steps

1. Write scripts/tests/history-append-only.test.mjs red-first over a fixture repository: appends pass (the positive control); a changed record fails and names its commit; a removed record fails; a merge of two branches that both appended to one log passes; a rewrite undone by a later commit still fails; a migrate-prefix move passes
2. Implement the guard over git, record by record, parent by child
3. Add `findings` to the guard's --json entry and document the selector in check --help and docs/external-consumers.md

## Acceptance criteria

- [ ] check --append-only fails on a removed or changed history record in the range, names it, and passes appends and merges [proof: append-only]
- [ ] check --help names --append-only [proof: help-names-selector]
- [ ] the full suite stays green [proof: suite]
