---
id: TL-380
title: "One repository is the complete product boundary"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P2
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-08
blocked_by: [TL-377]
blocks: []                         # ids this task will unblock
related_docs:
  - docs/branchling-global-tool.md
  - README.md
verification:
  - id: one-repository
    bash: "node --test scripts/tests/single-repository-scope.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

One invocation operates on one resolved backlog and one repository. The project
registry, cross-project query and project switcher no longer ship, removing a
portfolio layer that is unrelated to repository-owned authorization and proof.

## Context

Backlog resolution remains portable: `--dir`, `BACKLOG_DIR`, upward detection
and co-location still identify one backlog. User-local preferences may remain
for facts about the machine. What is removed is the registry of other projects
and every operation that assembles several repositories into one answer.

The change deliberately gives up portfolio visibility. External trackers and
orchestrators already own that problem; Branchling's reviewable facts live in
one repository and should be understandable without a machine-local index.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/registry.mjs`, `scripts/project-command.mjs` and
   `scripts/cross-project.mjs` — identify the complete portfolio surface.
2. `scripts/paths.mjs` — preserve all four one-backlog resolution sources.
3. `scripts/query.mjs` and `scripts/build-viewer.mjs` — remove cross-project
   consumers.
4. `docs/branchling-global-tool.md` — retain the global binary boundary while
   removing the registry conclusion.

## Steps

1. Remove `project` and `query --all-projects` from CLI, JSON, MCP and docs.
2. Remove the registry store and project-switching consumers.
3. Keep local preferences disjoint from project configuration.
4. Prove commands still resolve nested and co-located backlogs without a
   registry and still explain the selected path through `where`.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] The public surface contains no project registry, all-project query or
      cross-project viewer state. [proof: one-repository]
- [ ] `--dir`, `BACKLOG_DIR`, upward detection and co-location still resolve one
      backlog correctly. [proof: one-repository]
- [ ] Deleting any old machine-local registry does not affect ordinary commands.
      [proof: one-repository]
- [ ] The complete remaining suite passes. [proof: suite-green]
