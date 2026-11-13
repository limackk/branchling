---
id: TL-711
title: "Every test that reads a script's source text uses scriptSource"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: source-read-guard
    bash: "node --test scripts/tests/script-source-reads.test.mjs"
---

## Goal

Every test that reads a script's SOURCE TEXT reads it through scriptSource() in scripts/tests/_repo.mjs, and a guard fails on a test that reads a file under scripts/ (not scripts/tests/) with readFileSync directly.

## Context

Inside a mutation run (scripts/mutation-run.mjs) the files Stryker mutates are instrumented copies in a sandbox: every string literal is wrapped in a mutant switch, so a regex or substring check over that text can fail in Stryker's initial run, which then judges no mutant. TL-653 added scriptSource(name), which reads the original from the tree the run started in (MUTATION_SOURCE_ROOT); json-kind-registry.test.mjs and agent-hooks.test.mjs (TL-674) use it. About forty other reads still go through readFileSync(join(SCRIPTS_DIR|SCRIPTS|HERE/..|ROOT/scripts, <module>)) - for example json-envelope.test.mjs lines 269-281, next.test.mjs around line 403, provider-adapter-boundary.test.mjs around line 134, today-stamp.test.mjs, ui.test.mjs, release-status.test.mjs, change-reason.test.mjs, cross-branch-state.test.mjs. Each is latent: it fails the initial run only when the module it reads is in the mutate list AND its pattern touches a string literal. Found with: grep -rnE 'readFileSync\(join\((SCRIPTS_DIR|HERE, "\.\."|SCRIPTS|ROOT, "scripts")' scripts/tests/*.test.mjs. Reads of _template.md and docs/ are not scripts and are not mutated; they are out of scope. A test of a module's BEHAVIOUR should import it instead, as the scriptSource() header says.

## Steps

1. Convert each direct source read of a scripts/*.mjs module in scripts/tests/ to scriptSource()
2. Add a guard test that fails on a direct readFileSync of a scripts/*.mjs module in a test, with a positive control showing it detects one

## Acceptance criteria

- [x] No test reads a script's source text other than through scriptSource() [proof: source-read-guard]
