---
id: TL-595
title: "A lagging task template is refreshed by one command"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-595
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: [TL-594]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: template-refresh
    bash: "node --test scripts/tests/doctor.test.mjs scripts/tests/template-refresh.test.mjs"
---

## Goal

One command adds the frontmatter fields a backlog's `_template.md` lacks, copied with their comments from the template this release ships, without touching any line the project wrote, so the `template` row of `doctor` can name a command instead of a manual copy.

## Context

TL-588 made `doctor` report the shipped fields missing from a backlog's `_template.md` (`checkTemplate` and `templateFields` in scripts/doctor.mjs). No command refreshes that file: `init` copies it once and never again, so the row's repair is currently the sentence "copy the lines for <keys> from <shipped> into <own>". The other copied files already have a refresh: `instructions --update-nudge` for the agent pointer, `skills install --refresh` for the skill, and since TL-588 `hooks install` replaces a stale block of its own. The template differs from those because it is the project's file, not a fenced block: the project may have added fields, changed defaults and comments, or removed a field on purpose. A refresh therefore has to insert lines rather than replace the file, decide where each one goes (after the nearest preceding shipped key the template still has, otherwise at the end of the frontmatter), and never rewrite an existing line. Which command carries it (`init --refresh-template`, a `template` subcommand, or something else) is part of the decision; `init` is about an empty directory, which argues against putting it there.

## Steps

1. Choose the command surface and write it down in the module header, with the rejected alternatives.
2. Insert each missing shipped key with its line from the shipped template, placed after its nearest preceding shipped key; leave every existing line byte for byte; print what was added and change nothing when nothing is missing.
3. Make the `template` row of `doctor` name that command as its fix, and test that running the printed fix turns the row OK.

## Acceptance criteria

- [x] A template missing shipped fields gains exactly those lines, in shipped order, every other line unchanged, and doctor's template row names the command and is OK after it runs. [proof: template-refresh]
