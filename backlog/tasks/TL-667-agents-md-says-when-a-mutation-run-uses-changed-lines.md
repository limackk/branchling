---
id: TL-667
title: "AGENTS.md says when a mutation run uses --changed-lines"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: agents-names-changed-lines
    bash: "grep -q -- '--changed-lines' AGENTS.md"
---

## Goal

The mutation-run guidance in AGENTS.md says when to use `--changed-lines` (TL-648), so the pre-commit check it prescribes for tests written in the same pass is one a supervised loop can finish.

## Context

TL-648 added `--changed-lines` to scripts/mutation-run.mjs: each changed module is mutated only on the lines `git diff --unified=0` against the merge base reports as added or changed, passed to Stryker as `path:start-end` entries. AGENTS.md, section "Mutation runs: whether the assertions would notice", still tells a session to start with `--named-only` over whole modules. For scripts/mutation-run.mjs itself that selects three test files that run Stryker of their own, which puts a whole-module run far beyond the 1800 s a loop allows, so the rule is skipped in practice (observed on TL-648, 2026-11-09). Deciding whether `--changed-lines` becomes the default first step, an alternative, or something else, and what a changed-lines run does NOT prove (a mutant spanning a changed and an unchanged line is never created; a deletion leaves nothing to mutate), is a wording decision about the prescribed procedure, not part of TL-648's thesis. Any loop prompt or skill that quotes the mutation command (for example .claude/skills/prove) should be checked in the same pass.

## Steps

1. Read the mutation-run section of AGENTS.md and the header of scripts/mutation-run.mjs.
2. State in AGENTS.md when `--changed-lines` is the first run and what it leaves unmeasured.
3. Align any skill that prints the mutation command with it.

## Acceptance criteria

- [x] AGENTS.md names --changed-lines in its mutation-run guidance [proof: agents-names-changed-lines]
