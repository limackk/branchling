---
id: TL-176
title: "The registry accumulates entries for directories that are gone"
type: bug
labels: []
board: main
epic: "Backlog — open source publication"
priority: P2
status: pending
owner: unassigned
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-03
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: prune-removes-only-the-dead
    bash: "node --test scripts/tests/registry-prune.test.mjs"
---

## Goal

A person can see, and remove, the registry entries whose directories no longer
exist — without editing the file by hand and without removing them one at a
time.

## Context

Measured on this machine on 2026-09-03, while implementing TL-36:

```
registered: 1239   answered: 892   unavailable: 347
```

Nearly all of them are temporary directories from test runs made before
`isolateHome()` covered the registry: `/var/folders/…/worktrail-prefix-8SX6vL`
and hundreds like it. The leak itself is closed — the suite writes to a
throwaway home now — but nothing ever cleans up what it left, and the registry
is a file in the user's data directory that only grows.

Two costs, and the second is the one that matters:

- **`project list` is unreadable** and the cross-project pass spends most of its
  time on directories that are not there.
- **A real absence is hidden among hundreds of dead ones.** TL-36 reports an
  unavailable project so that "you moved the repository" cannot read as "that
  project has no tasks" — and that report is worth nothing at the bottom of a
  list of 347.

`remove` already exists and takes one name or path. What is missing is the
question "which of these are dead" and the ability to act on all of them at
once.

## Pre-flight reading

1. `scripts/registry.mjs` — `readRegistry()` already splits `projects` from
   `missing`; the answer is computed and nothing consumes it.
2. `scripts/project-command.mjs` — where `add`, `list` and `remove` live.
3. `scripts/cross-project.mjs` (TL-36) — the other consumer of `missing`, whose
   report this makes legible again.

## Steps

1. `project list` marks the unavailable entries instead of listing them as if
   they were live, and says how many there are.
2. `project prune [--dry-run] [--json]` removes the entries whose directory is
   gone. `--dry-run` first, and the removal names every entry it takes.
3. A directory that EXISTS but is no longer a backlog is NOT pruned by default:
   an emptied-out checkout is somebody's mistake to fix, a deleted directory is
   not. A separate flag may include them.
4. `doctor` mentions a registry with dead entries, since that is where a person
   looks when something feels wrong.

## Acceptance criteria

- [ ] `project prune` removes entries whose directory does not exist and leaves
      every live one. [proof: prune-removes-only-the-dead]
- [ ] An existing directory that is no longer a backlog is NOT removed by
      default, and the difference is stated. [proof: prune-removes-only-the-dead]
- [ ] `--dry-run` changes nothing and names what it would remove. [proof: prune-removes-only-the-dead]
- [ ] `project list` distinguishes live entries from dead ones. [proof: prune-removes-only-the-dead]

## Decisions

- Pruning is never automatic. The registry is the one file that records a
  decision the user made; a network share not mounted this morning is not a
  reason to forget a project.
