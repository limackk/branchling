---
id: TL-562
title: "Every ledger record of a task is readable as JSON"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: ledger-read
    bash: "node --test scripts/tests/log-records-json.test.mjs"
  - id: consumers-doc
    bash: "grep -qE 'log.*--records' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Every record in a task's ledger is readable as JSON through the CLI — status transitions with their reason, actor and source, `contractCapability`, vouches and refusals — so a program never has to read `history/<ID>.jsonl` itself.

## Context

`branchling log <ID> --json` is the read side of `history`, but it returns exchanges (handoffs) and, with `--decisions`, decisions and open questions. A status transition such as `pending -> done` with `reason: proven`, the `contractCapability` verdict attached to it, and `vouch` or `refusal` records are not reachable through any reading command on 2026-11-04. The M0 measurement in the branchling-proof workspace (research/m0/frame.mjs) needed exactly those records — which tasks were closed as proven, when, and by whom — and had to parse the files from git objects. The same records are what an audit or an evidence pack is built from. The change belongs in scripts/log-task.mjs as a mode of `log`, not in a new command: `log` already owns reading the history, and its `--limit` contract (the answer says how many records were left behind) applies unchanged.

## Steps

1. Write a red-first test: a fixture task taken, refused once by done, then closed as proven; the new mode must return every record in order with id, ts, field, from, to, actor, source, reason and any extra keys such as contractCapability
2. Add the mode to scripts/log-task.mjs (for example `log <ID> --records --json`), with --limit reporting what it left out
3. Document the new kind in docs/external-consumers.md

## Acceptance criteria

- [ ] every ledger record of a task, including reason and contractCapability, is returned as JSON in recorded order [proof: ledger-read]
- [ ] the external consumer contract documents the new mode [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
