---
id: TL-647
title: "A bare call without a terminal does not block forever"
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
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: bare-noninteractive
    bash: "node --test scripts/tests/cli-bare-noninteractive.test.mjs"
---

## Goal

A bare `branchling` with no subcommand, run without a terminal (from a git hook, a CI step or a script whose variable came out empty), does not start a server that never exits. It either fails with a sentence that names `branchling serve`, or the project records a decision that the current behaviour stays and why.

## Context

`resolveCommand()` in scripts/cli.mjs returns `serve` for an empty argv, deliberately: "the bare command with no arguments is still the server". That is right in a terminal. It is wrong for a caller that lost its subcommand: such a call does not fail, it blocks forever. This was observed on 2026-11-07, when a git hook in a mutation-run fixture ran the CLI with no arguments and the server it started kept the hook alive for hours (TL-646). The user-facing risk is the same with any `branchling $CMD` where `$CMD` is empty. Deciding needs a person: some users may start the viewer from scripts on purpose. Options: refuse when stdin and stdout are not a TTY unless `serve` is explicit; keep the behaviour and only print a warning on stderr; or keep it unchanged.

## Steps

1. Ask the owner which option holds, with `branchling ask`.
2. Implement the decision; if behaviour changes, the explicit `serve` command still starts the server without a terminal.
3. Test both paths: a non-TTY bare call (stdin closed) answers within a timeout with a non-zero exit and a sentence naming `serve`; an explicit `serve` still serves.

## Acceptance criteria

- [ ] a bare call without a terminal does not block forever [proof: bare-noninteractive]
