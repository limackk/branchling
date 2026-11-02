---
id: TL-534
title: "plan --json answers a broken plan as a refusal and carries titles"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-refusals
    bash: "node --test scripts/tests/plan-command.test.mjs scripts/tests/plan.test.mjs scripts/tests/external-consumer-doc.test.mjs"
---

## Goal

`plan --json` always answers an envelope: a plan that contradicts blocked_by or does not parse is a refusal with its problems, never an empty stdout or an empty plan, and every planned task carries its title, status and blockers, closed ones included.

## Context

Consumer: branchling-ui (limackk/branchling-ui), which may reach a backlog only through this CLI's --json answers. Its UI-22 waits on this. At 86b6209: a plan that contradicts `blocked_by` exits 1 with empty stdout and the message on stderr, although `plan --help` calls the case refused, so a consumer reads it as its own error; an unparsable plan.yaml (`waves: [oops`) answers `exists: true, waves: []` with exit 0, which reads exactly like an empty plan; the envelope carries ids only, so a consumer needs a second `query --json` for titles, and `query` returns active tasks only, so a closed planned task has no title. Changing `waves[].tasks` from ids to objects changes the root shape and must be stated as such.

## Steps

1. A contradiction answers a `plan` envelope with `refusalKind: "plan-contradicts-blocked-by"`, `refusal` and `problems: [...]`, exit 1
2. An unparsable file answers `refusalKind: "plan-unparsable"` with the parser's problems and line numbers, exit 1
3. Each wave task becomes `{ id, title, status, blocked_by }`, read from tasks/ and the archive alike
4. Document both refusal kinds and the new task shape in docs/external-consumers.md

## Acceptance criteria

- [ ] A contradicting plan and an unparsable plan each answer their refusal envelope with exit 1, and a closed planned task carries its title. [proof: plan-refusals]
