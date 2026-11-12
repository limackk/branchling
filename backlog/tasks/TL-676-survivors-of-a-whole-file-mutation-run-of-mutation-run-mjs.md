---
id: TL-676
title: "Survivors of a whole-file mutation run of mutation-run.mjs are killed or named"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: awaiting_vouch  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [mutation]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: survivors-addressed
    manual: "The whole of scripts/mutation-run.mjs is mutated in seven line-range chunks cut at top-level function boundaries (150-238 with 944-1081, 239-356, 357-429, 430-571, 572-787, 788-943, 1082-1252; --concurrency 2, each with --keep-report), the chunks together holding all of the module's mutants as --plan counts them; every Survived mutant in the kept reports is killed by an assertion of this task or named as equivalent in its commit"
---

## Goal

The mutants of scripts/mutation-run.mjs that survive a whole-file mutation run are each killed by a new assertion or named as equivalent.

## Context

TL-629 ran `node scripts/mutation-run.mjs --files scripts/mutation-run.mjs --concurrency 2` over the whole module on 2026-11-09 (811 mutants, judged by the five test files that name mutation-run.mjs, including the nested-Stryker tests under scripts/tests/mutation/). Result: 557 Killed, 2 Timeout, 252 Survived, score 68.93%. Survivors per function: main 79, runStryker 38, parseArgs 19, changedLineRanges 14, summarise 11, defaultConcurrency 10, processListing 9, git 9, sweepLeftovers 8, strykerConfig 7, reportLeftovers 7, and 1 to 4 each in selectTests, scriptsIn, rangeReport, plan, mergeRanges, leftoverProcesses, importClosure, hunkRanges, directorySymlinks, lines, isMutable, commandScripts, strykerBin, shellQuote, changedModules. Many in main() and runStryker() are message strings and the text-mode output, which no test reads; some (defaultConcurrency, the `ps` failure path) may be equivalent or not worth asserting. AGENTS.md: a surviving mutant is a missing assertion, not a number to raise; equivalent mutants are named, not chased. TL-629 deliberately did not address these: its thesis was that the nested run works inside the sandbox. A whole-file run takes about 32 minutes at --concurrency 2; prefer `--changed-lines` or a narrowed `--files path:start-end` while iterating.

## Steps

1. Rerun the whole-file mutation run and list the survivors grouped by function
2. For each group, write the assertion that kills it in scripts/tests/mutation-run.test.mjs (no Stryker needed) or in a scripts/tests/mutation/ test, and check that it fails on that mutant
3. Name the equivalent survivors in the commit body with the reason each cannot be killed

## Acceptance criteria

- [ ] every remaining survivor of mutation-run.mjs is one the commit names as equivalent [proof: survivors-addressed]
