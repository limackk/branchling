---
id: TL-655
title: "The four-laws references point at a section that states them"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-dangling-section
    bash: "! grep -rn 'branchling-global-tool.md`\\?)\\? §3' AGENTS.md docs/"
  - id: docs-links
    bash: "node scripts/cli.mjs check --docs"
---

## Goal

Every document that sends a reader to `docs/branchling-global-tool.md` §3 for the four laws lands on text that states them, or points somewhere that does.

## Context

`AGENTS.md` (line 15, "Full reasoning: docs/branchling-global-tool.md §3"), `docs/external-consumers.md` (line 10, "The fourth law (`docs/branchling-global-tool.md` §3)") and `docs/release-tracking.md` (line 22, "the laws (`docs/branchling-global-tool.md` §3)") all cite a §3 of that file. Since TL-380 rewrote it on 2026-09-08 the file has no numbered sections and does not state the four laws at all: it describes the one-repository product boundary. A reader following the reference finds nothing about laws II, III or IV. `check --docs` stays green because it judges the path, not the section a sentence names. Found on 2026-11-08 while working TL-579, which now points `docs/functionality.md` at that file as "the product boundary" and keeps the four laws in its own §1. Either restore a section that states the laws with their reasoning (the full reasoning existed before TL-380, in git history), or repoint the three references at the place that states them now (`docs/functionality.md` §1 and `AGENTS.md` both list them).

## Steps

1. Decide where the four laws and their reasoning live from now on, one place.
2. Repoint or restore so that every `branchling-global-tool.md` §3 reference resolves to that text.
3. Run `node scripts/cli.mjs check --docs`.

## Acceptance criteria

- [x] No document cites a §3 of branchling-global-tool.md that does not exist. [proof: no-dangling-section]
- [x] Every documentation link still resolves. [proof: docs-links]
