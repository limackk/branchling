---
id: TL-768
title: "The Windows job no longer fails tests that assumed POSIX"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-21
updated: 2026-11-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: posix-unchanged
    bash: "FORCE_COLOR=1 node --test scripts/tests/fixture-dir.test.mjs scripts/tests/jira-proof.test.mjs scripts/tests/mutation-run.test.mjs scripts/tests/query-owner-worktrees.test.mjs scripts/tests/skills-install.test.mjs scripts/tests/suite-state-leak.test.mjs"
  - id: windows-job
    manual: "The Windows job of the test workflow on the commit that carries this change passed its tests step; name the run id."
---

## Goal

The tests that were red on the Windows job only because they assumed POSIX hold there: path spellings are compared the way the tool spells them, directory links are made as directory links, and the tests of behaviour Windows does not have are skipped with that reason. With TL-760 to TL-765 this is the last of the 37 Windows failures of run 44324012719.

## Context

Windows was green at 89de6a58 (TL-624); every failure below came with a test added since. Fixed: query-owner-worktrees and suite-state-leak compared against JS realpathSync, which keeps 8.3 short names (RUNNER~1), while the tool writes canonicalPath (realpathSync.native) — the leak guard's positive control is what showed its sibling passing with no evidentiary force; skills-install created links to not-yet-existing directories without the 'dir' type, so Windows made file links and stat through them failed with EPERM; mutation-run compared git's forward-slash root and a child's cwd with a backslash path, built a regex with '/', read env.PATH (Path on Windows), joined '/state' unresolved, made dangling links with MSYS ln (which refuses), and removed a fixture while the SIGKILLed child still had it as cwd (EBUSY masking the result). Skipped on win32, each with its reason: fixture-dir's signal tests (kill() from another process is TerminateProcess, SIGHUP is ENOSYS) and orphan tests (a child dies with its killed runner); jira-proof's removed-cwd test (Windows cannot remove a running process's cwd); and the mutation-run tests that execute the POSIX sandbox command, process groups or ps, which cannot work on Windows at all — TL-767 makes that run refuse. Diagnosed from the CI log, not on a Windows machine: only the Windows job of the test workflow can confirm it.

## Steps

1. Compare paths through canonicalPath in query-owner-worktrees, suite-state-leak and mutation-run.
2. Create directory links with the 'dir' type in skills-install and dangling links with symlinkSync in mutation-run.
3. Read PATH case-insensitively, resolve '/state', and wait for the killed child before removing its fixture.
4. Skip the POSIX-only tests on win32 with their reason.

## Acceptance criteria

- [ ] every changed test still holds on this platform, so the Windows changes weakened nothing here [proof: posix-unchanged]
- [ ] the 37 Windows failures of run 44324012719 are gone on a Windows runner [proof: windows-job]
