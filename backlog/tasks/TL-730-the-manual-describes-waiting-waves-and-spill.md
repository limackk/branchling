---
id: TL-730
title: "the manual describes waiting waves and --spill"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-13
blocked_by: [TL-707]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: manual-names-waiting-kinds
    bash: "grep -q 'wave-claimed-elsewhere' docs/manual.md && grep -q 'wave-awaits-merge' docs/manual.md && grep -q -- '--spill' docs/manual.md"
---

## Goal

docs/manual.md describes the waiting refusal kinds of `next --plan`, `--spill` on `next` and `run`, and what `run --plan --wait` does with each kind.

## Context

TL-683 gave `next --plan` the refusal kinds `wave-claimed-elsewhere` and `wave-awaits-merge` and the opt-in `--spill`; TL-707 made `run --plan` act on them (the stop sentence names the kind and the ids, `--wait` polls only a wave `next` called waiting, a `nothing-to-take` wave ends the run) and pass `--spill` through. Both are described in `next --help` and `run --help` (scripts/cli.mjs), but the section of docs/manual.md that introduces `--plan` ("Asking the dispatcher to follow it") says nothing about either: a reader of the manual still learns that exit 3 under `--plan` means nothing is left, which is the reading TL-683 was filed against.

## Steps

1. Add a paragraph after "Asking the dispatcher to follow it" in docs/manual.md: the three refusal kinds and what each means, `--spill` and what still holds a spilled wave back, and how `run --plan --wait` treats each kind
2. Keep the wording consistent with `next --help` and `run --help`; do not copy flag lists that `--help --json` already derives

## Acceptance criteria

- [x] the manual names both waiting kinds and --spill [proof: manual-names-waiting-kinds]
