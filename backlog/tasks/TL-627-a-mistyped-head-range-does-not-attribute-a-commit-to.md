---
id: TL-627
title: "A mistyped head range does not attribute a commit to thousands of tasks"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-4
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [attribution]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: wide-range-endpoints-only
    bash: "node --test scripts/tests/modified-files.test.mjs"
---

## Goal

A mistyped range at the head of a commit title cannot attribute that commit's files to thousands of tasks; a range wider than a stated bound counts only its two endpoints, as a reversed range already does.

## Context

titleIds() in scripts/modified-files.mjs (TL-614) expands a range at the head of a commit title, such as TL-607..TL-611, into every id it spans, and parseLog() then gives each of those ids its own Set of the commit's files. Nothing bounds the width: a typo such as `TL-6..TL-60000` at the head of one title creates about 60000 map entries, each holding a copy of the file set, and `query --modified-file` and the capability record `done` writes would then attribute that commit's files to tasks that never existed or never touched them. A reversed range already falls back to its two endpoints because nothing says what was meant between them; an implausibly wide range is the same kind of statement. The bound must be a named constant with its reason in the module header (for example derived from the widest range in this repository's real history, which a supervisor measured as small), not a value from config.yaml, because it is part of the parsing rule rather than the project's vocabulary.

## Steps

1. Measure the widest head range in `git log --no-merges --format=%s` of this repository and choose a bound with clear headroom above it
2. In titleIds(), when hi - lo exceeds the bound, add only the two endpoints, and record the rule and the rejected alternatives (refusing the commit, failing the command) in the module header
3. Add a test in scripts/tests/modified-files.test.mjs: a fixture title with a range wider than the bound yields exactly its two endpoints, with a positive control showing a range within the bound still expands to every id

## Acceptance criteria

- [x] A head range wider than the bound counts only its endpoints, and a range within the bound still expands to every id it spans [proof: wide-range-endpoints-only]
