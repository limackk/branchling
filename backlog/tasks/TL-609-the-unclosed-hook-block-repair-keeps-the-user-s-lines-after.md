---
id: TL-609
title: "The unclosed hook block repair keeps the user's lines after it"
type: bug
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: unclosed-advice-keeps-user-lines
    bash: "node --test scripts/tests/hooks-install.test.mjs scripts/tests/doctor.test.mjs"
---

## Goal

The repair named for a hook block that opens and never closes does not tell the user to delete their own lines that follow the opening marker.

## Context

Both `hooks install` (runInstall in scripts/hooks-command.mjs, the `unclosed` refusal) and doctor's git-hooks-current row (staleHooksRow in scripts/doctor.mjs, after TL-600) say to put the printed block 'in place of the lines from `<opening marker>` onwards'. When the user's own hook commands follow an unclosed block, as the unclosed fixture in scripts/tests/hooks-install.test.mjs shows, following that advice literally deletes them. The refusal itself is right: the tool cannot know where the block was meant to end. The advice is what overreaches. The TL-600 supervisor recorded this as a minor issue.

## Steps

1. Reword both messages so they say that the old block ends where its last gate line is and that the user's lines after it stay, or name the exact line range the tool can see
2. Keep doctor and install saying the same thing, preferably from one shared string
3. Add a test in hooks-install.test.mjs and doctor.test.mjs that follows the printed advice on a fixture with the user's lines after the unclosed block and asserts those lines survive

## Acceptance criteria

- [ ] Following the printed repair for an unclosed block keeps the user's own hook lines that follow it [proof: unclosed-advice-keeps-user-lines]
