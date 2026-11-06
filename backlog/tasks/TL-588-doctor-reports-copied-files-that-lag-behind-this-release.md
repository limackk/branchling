---
id: TL-588
title: "Doctor reports copied files that lag behind this release"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: [TL-585]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: doctor-reports-lagging-copies
    bash: "node --test scripts/tests/doctor.test.mjs scripts/tests/hooks*.test.mjs"
---

## Goal

`doctor` reports every file an earlier release copied into a repository that no longer matches what this release would write, and names the one command that brings each up to date.

## Context

Several files are copied once and then frozen, each by its own rule. Measured on 2026-11-06 with a v0.1.0 backlog under the v0.3.0 code: `doctor` printed no errors and no warnings while backlog/_template.md lacked `release`, `target` and `conflict_group` (all three in the shipped _template.md). The writing commands add those fields on demand, so nothing breaks, but a person editing a task by hand never learns they exist. The git hook block is judged by its marker alone (`inspect()` in scripts/hooks-command.mjs returns `ours` without comparing the text to `hookBlock()`), so a change to the hook line in a later release would never reach an installed hook and doctor would say OK. The agent pointer is the one copied file that is already versioned (NUDGE_VERSION, refreshed by `instructions --update-nudge`); the skill copy is handled by its own task (TL-585). Doctor fixes nothing by design, so this task only adds detection and names the repair; a refreshing command is in scope only if no existing command already does it.

## Steps

1. Compare the frontmatter keys of the backlog's _template.md with the shipped one and report the missing ones as INFO, with the fields' one-line comments.
2. Compare the installed hook block with `hookBlock()` for each hook name and report a difference as WARN with `hooks install` (which must then replace a stale block of its own, between its markers only).
3. Add a doctor test per case with a fixture, plus a positive control where both are current.

## Acceptance criteria

- [ ] doctor reports a template missing a shipped field and a hook block whose text differs from hookBlock(), and reports neither when both are current; hooks install replaces a stale block of its own. [proof: doctor-reports-lagging-copies]
