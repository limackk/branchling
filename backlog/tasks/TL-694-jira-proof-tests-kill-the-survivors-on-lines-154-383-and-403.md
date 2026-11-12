---
id: TL-694
title: "jira-proof tests kill the survivors on lines 154, 383 and 403"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
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
  - id: jira-proof-tests
    bash: "node --test scripts/tests/jira-proof.test.mjs"
---

## Goal

Each of three surviving mutants in scripts/jira-proof.mjs is killed by a test in scripts/tests/jira-proof.test.mjs, or named as equivalent with the reason.

## Context

A mutation run for TL-642 (`npm run mutation -- --named-only --files scripts/jira-proof.mjs --concurrency 2`, 445 mutants, 2026-11-10) left these alive besides the git runner's equivalent ones on line 306 (`maxBuffer` arithmetic, and the `utf8` encoding, which is equivalent because `addedHistoryEntries` in scripts/pr-summary.mjs decodes with `String(diff)`):

- line 154, `jiraTicketOf`: the regex `/^(.+)\/browse\/([^/]+)$/` mutated to drop the `^` anchor (`/(.+)\/browse\/([^/]+)$/`). Probably equivalent, since `(.+)` is greedy from the first character either way; confirm or kill it.
- line 383, the text report's skipped list: a string literal emptied — no test asserts the exact separator or line shape of a skipped entry (`"  " + s.task + "  " + SKIP_WORDS[s.reason] + "\n"`).
- line 403, the CLI's `--dir` refusal handler: `if (!isBacklogDirRefusal(e)) throw e;` mutated to never rethrow, so an unexpected error from `resolveBacklogDir` is not proven to propagate instead of being reported as a refusal.

Done when a rerun of the same command lists none of the three, or the commit names each remaining one as equivalent with its reason.

## Steps

1. Reproduce the run with the command above and read the survivors on lines 154, 383 and 403.
2. Add assertions to scripts/tests/jira-proof.test.mjs that fail on each non-equivalent mutant, checking each by hand against the mutated line.
3. Rerun the mutation command and confirm the survivors are gone or named as equivalent.

## Acceptance criteria

- [x] The jira-proof tests that kill the three survivors pass [proof: jira-proof-tests]
