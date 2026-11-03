---
id: TL-542
title: "show --json can print a task's body"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-03
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: show-body
    bash: "node --test scripts/tests/show.test.mjs"
---

## Goal

A task's markdown body can be read as JSON through one command, so a consumer that may not read task files can show it.

## Context

Found by branchling-ui (its UI-37); checked against 7af44b6 and still open. `show --help` says the body is never reprinted and points at the file; `query --text` matches id and title only; `log` carries history; `resume` is a successor briefing that needs the owner as actor; `body` (TL-523) is a write. A consumer whose contract forbids reading task files (branchling-ui's does, so every write keeps going through validation and history) has no way to show what a task says. It renders a placeholder instead.

## Steps

1. Add `--body` to `show <ID> --json`, adding a `body` string (the markdown after the frontmatter, verbatim, empty string when there is none) to the task-show envelope; without the flag the envelope is unchanged
2. Read the body from tasks/ and the archive alike, so a closed task's body is reachable
3. Document the flag and the key in docs/external-consumers.md, including that the body is untrusted markdown a consumer must render safely

## Acceptance criteria

- [x] show <ID> --json --body returns the fixture task's body verbatim, for an active and an archived task; without --body the envelope carries body: null (decided on the task's question: the envelope never drops a declared key). [proof: show-body]
