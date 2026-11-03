---
id: TL-541
title: "check --json without a backlog answers an envelope"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-03
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: check-no-backlog
    bash: "node --test scripts/tests/check-no-backlog.test.mjs"
---

## Goal

`check --json` over a directory that is not a backlog answers a JSON envelope with exit 1, the way `doctor --json` does, instead of an empty stdout.

## Context

Found by branchling-ui (its UI-34); checked against 7af44b6 and still open. `doctor --json` over a directory without a backlog exits 1 with a normal envelope (root: null and one failed `backlog` check), which a consumer shows as a verdict. `check --json` over the same directory prints the human 'no backlog here' message on stderr, nothing on stdout, and exits 1, so a consumer cannot tell it from a crash or its own wrongly built call without parsing stderr text, which an external-interface contract should not require. (On 0.2.0 it was a stack trace; 0.3.0 made the message human but not the JSON.)

## Steps

1. With --json and no backlog, print a `check` envelope shaped like a failed verdict: ok false, root null, failed ["backlog"], the guards list empty or each guard marked not run, and the sentence that is printed today
2. Keep exit 1 (a verdict about the directory), and exit 2 only for a wrong invocation
3. Document the shape in docs/external-consumers.md next to doctor's

## Acceptance criteria

- [x] check --json in an empty directory prints a check envelope with root null and failed ["backlog"] and exits 1; the human form still prints the 'no backlog here' message. [proof: check-no-backlog]
