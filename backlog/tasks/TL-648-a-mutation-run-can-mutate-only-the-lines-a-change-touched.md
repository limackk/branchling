---
id: TL-648
title: "A mutation run can mutate only the lines a change touched"
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
conflict_group: [mutation]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: changed-lines
    bash: "node --test scripts/tests/mutation-changed-lines.test.mjs"
---

## Goal

A mutation run can mutate only the lines a change touched, so the check AGENTS.md asks for before committing tests written in the same pass fits in the time a supervised loop has. The report says which line ranges it mutated.

## Context

Observed on 2026-11-07, on TL-573. The supervisor ran `npm run mutation -- --named-only` for three changed modules (release-status.mjs, release-view.mjs, release-gaps.mjs): 2373 mutants, about two hours on this machine. A 590 s tool timeout stopped it at 7% with 32 survivors nobody reviewed. The change itself was about 60 lines. scripts/mutation-run.mjs selects whole FILES changed against main (`--files`, `--named-only`); Stryker's `mutate` accepts `path:startLine-endLine` ranges, so the diff hunks against `--base` can become ranges. At whole-module size the rule in AGENTS.md is skipped in practice, which is worse than a smaller honest run.

## Steps

1. Add an option (for example `--changed-lines`) to scripts/mutation-run.mjs that turns `git diff --unified=0 <base>` hunks into `file:start-end` mutate entries.
2. Report the ranges, and say plainly that lines outside them were not mutated.
3. Test: on a fixture module with one changed function, the run creates mutants only inside that function's lines.

## Acceptance criteria

- [ ] a mutation run limited to changed lines mutates nothing outside them [proof: changed-lines]
