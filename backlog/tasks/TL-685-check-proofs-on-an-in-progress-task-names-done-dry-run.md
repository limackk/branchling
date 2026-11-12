---
id: TL-685
title: "check --proofs on an in-progress task names done --dry-run"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
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
  - id: proofs-in-progress-remedy
    bash: "node --test scripts/tests/check-proofs-in-progress.test.mjs"
---

## Goal

`check --proofs --task <ID>` on an in_progress task refuses with a remedy naming `branchling done <ID> --dry-run`.

## Context

Agents use `check --proofs --task <ID> --own-only` as a self-check before closing, because `branchling instructions` mentions it (scripts/instructions.mjs around lines 655 and 861). On an in_progress task it answers `✗ proofs: TL-645 has no proof this audit can re-run — it is in_progress: neither a proven closing, nor a task nobody has started — nothing was run` with no remedy (message built around scripts/check-backlog-proofs.mjs:354). Seen 6 times between 2026-11-07 and 2026-11-09 (TL-574, TL-640, TL-644, TL-645). `done <ID> --dry-run` is the command that runs the whole contract and changes nothing.

## Steps

1. Add `→ branchling done <ID> --dry-run` to that refusal
2. Check the instructions text at those two places describes check --proofs as an audit of closed tasks, and points the pre-close self-check at done --dry-run
3. Test the refusal names the remedy

## Acceptance criteria

- [x] check --proofs on an in_progress task names done --dry-run [proof: proofs-in-progress-remedy]
