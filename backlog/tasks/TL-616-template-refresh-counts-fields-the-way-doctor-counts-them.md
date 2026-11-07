---
id: TL-616
title: "Template refresh counts fields the way doctor counts them"
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
conflict_group: [doctor]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: refresh-count-wording
    bash: "node --test scripts/tests/template-refresh.test.mjs"
---

## Goal

`template refresh` reports its count with the same singular and plural forms doctor uses, not 'field(s)'.

## Context

renderRefresh in scripts/template-command.mjs prints 'added N field(s)' (line 234 at the time of filing), while scripts/doctor.mjs reports counts of the same kind through its local plural() helper. The two commands describe the same template, one after the other, in different styles. Raised as a minor issue by the TL-595 supervisor. plural() is private to doctor.mjs, so the change is either to export a shared helper or to inline the singular/plural choice; a shared helper is preferable if another module already needs one.

## Steps

1. Choose where the singular/plural helper lives so both modules use one
2. Render 'added 1 field' and 'added N fields' (and the dry-run wording) through it
3. Assert both forms in scripts/tests/template-refresh.test.mjs

## Acceptance criteria

- [ ] template refresh says '1 field' for one and 'N fields' for several, never 'field(s)' [proof: refresh-count-wording]
