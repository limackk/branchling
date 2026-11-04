---
id: TL-561
title: "show --json prints a task's verification contract"
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
  - id: show-contract
    bash: "node --test scripts/tests/show-verification-json.test.mjs"
  - id: consumers-doc
    bash: "grep -qE 'show.*--json.*verification|verification.*show.*--json' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling show <ID> --json` carries the task's `verification:` entries, so a program can read a task's closing contract without reading its file.

## Context

Consumers reach branchling only through `--json` (branchling-ui's adapter rule; the branchling-proof workspace adopts the same rule). On 2026-11-04 no reading command exposes a task's contract: `show --json` returns schemaVersion, kind, ok, id, title, status, priority, confidence, blocks, file, deploy, elsewhere, scan, blockers, blocked, body, refusalKind, refusal and details, and `query --json` returns frontmatter fields without `verification`. The M0 measurement in branchling-proof (research/m0/) therefore had to parse task files from git objects, which its own AGENTS.md forbids for product code. The entries are parsed today by `parseVerification` and printed by `done`; `scripts/show-task.mjs` is the place to expose them. Each entry should carry its id, exactly one of `bash` or `manual`, and the acceptance criteria that point at it through `[proof: <id>]`, so a reader can join the prose to the check. Adding a key to the envelope must follow the schemaVersion policy of TL-72.

## Steps

1. Write a red-first test: a fixture task with a bash entry holding quotes and a backslash, a manual entry and a criterion linked by [proof: id]; `show --json` must return all three faithfully
2. Expose the parsed entries in scripts/show-task.mjs under a `verification` key, reusing parseVerification rather than a second parser
3. Document the key in docs/external-consumers.md beside the other --json kinds

## Acceptance criteria

- [ ] show --json returns every verification entry with its id, command or vouch text, and the criteria linked to it [proof: show-contract]
- [ ] the external consumer contract documents the new key [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
