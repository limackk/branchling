---
id: TL-719
title: "help --json names the roles vocabulary on the left side of run --agent-for"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-12
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: pair-left-vocabulary
    bash: "node --test scripts/tests/help-covers-flags.test.mjs"
---

## Goal

`<command> --help --json` can say that the LEFT side of a `<left>=<right>` flag draws on a project vocabulary. `run --agent-for <role>=<command>` and `run --profile-for <role>=<name>` take one of the project's `roles:` on the left, and today that is not expressed anywhere in the derived flag table.

## Context

TL-693 made `commandHelpJson()` in `scripts/cli.mjs` describe a `<from>=<to>` argument as a pair: `arg` holds the whole pair, the flag's own `dictionary`/`values`/`closed` are null, and the right-hand side is described under `target` with the vocabulary looked up by flag name in `FLAG_DICTIONARY`. That fits `import --status/--priority/--label`, whose vocabulary is on the right. For `run --agent-for` and `--profile-for` the vocabulary is on the LEFT (`roles`), and `--help --json` now reports both sides as free text (`target.dictionary: null`). An interface building a form from the answer cannot offer the project's roles for the left side. Before TL-693 these flags had no dictionary either, so this is a gap that became expressible, not a regression. The shape to add (for instance a `source` key mirroring `target`) is an interface change and needs its entry in `docs/external-consumers.md` beside the TL-693 paragraph.

## Steps

1. Decide how a pair flag names which side draws on which vocabulary (a per-flag table beside FLAG_DICTIONARY, keyed by flag and side).
2. Describe the left side of `run --agent-for` and `--profile-for` with the `roles` vocabulary, keeping `import` mapping flags unchanged.
3. Document the shape in docs/external-consumers.md and add a test with a fixture roles vocabulary, plus a positive control that import --status still carries its vocabulary on the target.

## Acceptance criteria

- [x] `run --help --json` describes the left side of `--agent-for` and `--profile-for` with the project's roles, while `import --status` still carries its vocabulary on the target side. [proof: pair-left-vocabulary]
