---
id: TL-176
title: "The registry accumulates entries for directories that are gone"
type: bug
labels: []
board: main
epic: "Backlog — open source publication"
priority: P2
status: done
owner: agent:claude
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

- [x] `project prune` removes entries whose directory does not exist and leaves
      every live one. [proof: prune-removes-only-the-dead]
- [x] An existing directory that is no longer a backlog is NOT removed by
      default, and the difference is stated. [proof: prune-removes-only-the-dead]
- [x] `--dry-run` changes nothing and names what it would remove. [proof: prune-removes-only-the-dead]
- [x] `project list` distinguishes live entries from dead ones, and says how
      many of each. [proof: prune-removes-only-the-dead]
- [x] `doctor` reports a registry with dead entries as a WARNING, never an
      error — a directory somewhere else must not fail this backlog's doctor. [proof: prune-removes-only-the-dead]

## Decisions

- Pruning is never automatic. The registry is the one file that records a
  decision the user made; a network share not mounted this morning is not a
  reason to forget a project.
- **The removal NAMES every entry it takes, rather than counting them.** The
  entry is the only record that a directory was ever a project of yours, so a
  number would leave nothing to put back if the removal turns out to be a
  mistake. `list` counts instead, and truncates at ten with "and N more" —
  there the length IS the problem.
- **`doctor` gets a row but never an error.** Registration is a precondition for
  nothing, so a registry full of dead entries is untidiness, not a fault in the
  backlog being examined; an error here would make `doctor` fail because of a
  directory somewhere else. It is in `doctor` at all because that is where
  somebody looks when something feels wrong.
- **This tree was not cleaned up as part of the task.** The command exists; what
  the user does with their own registry is their decision, and running a removal
  over 310 of their entries because a task happened to be open is not a fix, it
  is a side effect.
