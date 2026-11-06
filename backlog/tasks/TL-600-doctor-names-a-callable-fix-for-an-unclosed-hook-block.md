---
id: TL-600
title: "Doctor names a callable fix for an unclosed hook block"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: unclosed-block-fix-callable
    bash: "node --test scripts/tests/doctor.test.mjs scripts/tests/hooks-install.test.mjs"
---

## Goal

When an installed hook opens our block and never closes it, doctor's `git-gates-current` row names a command that succeeds, not `hooks install`, which refuses that file.

## Context

Found in the TL-588 review and reproduced in a scratch repository. `staleHooksRow` in scripts/doctor.mjs switches its fix to the `hooks print` paste only when another hook is foreign; for a block with an opening marker and no closing one it still names `hooks install   # replaces only the lines between its markers`. `runInstall` in scripts/hooks-command.mjs refuses such a block with exit 1 (the `unclosed` branch), so the row sends the user to a command that fails, which is exactly what the foreign-hook branch was written to prevent. The refusal does print the block, so nobody is stuck, but doctor's fix must be callable.

## Steps

1. Expose from `inspect()` (or `blockRange`) whether an installed block is unclosed
2. Make `staleHooksRow` name the `hooks print` paste and the file to repair when any stale block is unclosed
3. Add a doctor test with an unclosed block asserting the named fix, and run that fix to prove it is callable

## Acceptance criteria

- [ ] For an unclosed block doctor names a fix other than `hooks install`, and the existing stale-block fix still names `hooks install`. [proof: unclosed-block-fix-callable]
