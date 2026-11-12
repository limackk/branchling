---
id: TL-693
title: "help --json describes a from=to mapping flag as a pair, not a vocabulary"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mapping-flag-shape
    bash: "node --test scripts/tests/help-covers-flags.test.mjs"
---

## Goal

`<command> --help --json` describes a `<from>=<to>` mapping flag as what it is, not as a closed field vocabulary. Today `describeFlags()` in `scripts/cli.mjs` looks every flag up in `FLAG_DICTIONARY` by NAME alone (built from `FIELD_SHAPES`, around line 2171), so `import --help --json` reports `--status` as `{arg: "<from>", dictionary: "statuses", values: [the project's statuses], closed: true}`, and likewise `--label` (labels) and `--priority` (priorities, added by TL-641). The value those flags take is a pair: `<from>` is a Jira/GitHub name that is NOT in the project's vocabulary, only `<to>` is. An interface building a form from that answer — which `docs/external-consumers.md` tells consumers to do — would offer a closed drop-down of the project's statuses for the whole value, and every value it allows is refused by `import` as `is not a mapping`.

## Context

Found while adding `--priority` to `import` (TL-641). The usage line writes the flag as `--status <from>=<to>`, and the derivation reads only the token up to `=` as the argument. The fix belongs to the derivation, not to `import`: either recognise the `<from>=<to>` argument shape and describe it (for instance `arg: "<from>=<to>"`, with the dictionary applying to the target side under a separate key), or exclude such flags from the name-based lookup. Whichever shape is chosen is an interface change to the `--help --json` contract and needs its entry in `docs/external-consumers.md`.

## Steps

1. Reproduce: `node scripts/cli.mjs import --help --json` and read the `flags` entries for `--status`, `--label`, `--priority`.
2. Change `describeFlags()` so a `<from>=<to>` argument is described as a pair, and the vocabulary is attached to the target side only.
3. Add a test asserting the import mapping flags' description, with a positive control that `new --priority` still reports the closed priorities vocabulary.

## Acceptance criteria

- [x] `import --help --json` describes `--status`, `--label` and `--priority` as `<from>=<to>` pairs whose vocabulary applies to the target, while `new --priority` still reports a closed vocabulary. [proof: mapping-flag-shape]
