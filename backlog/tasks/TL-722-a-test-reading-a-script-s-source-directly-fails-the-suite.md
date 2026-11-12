---
id: TL-722
title: "A test reading a script's source directly fails the suite"
type: task
labels: []
board: main
epic: "Viewer"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-12
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: guard-red-on-fixture
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A test that reads a module's source text under scripts/ or bin/ without going through scriptSource() or sourceRoot() from scripts/tests/_repo.mjs fails the default suite, so the TL-702 conversion cannot silently regress.

## Context

TL-653 added scriptSource() and TL-702 routed every source-text guard in scripts/tests/ through it or through sourceRoot(), so a mutation run reads the uninstrumented tree that scripts/mutation-run.mjs names in MUTATION_SOURCE_ROOT. Nothing enforces that: the next test written with readFileSync(join(SCRIPTS_DIR, "x.mjs")) reintroduces the defect, and it stays invisible until a mutation run instruments a string literal its regex spans (a whole-module run over every module showed none of the converted guards failing today, so the hazard is latent rather than current). TL-702's evidence was a dynamic trace: a preload that wrapped fs.readFileSync/readdirSync, logging reads of scripts/*.mjs and bin/*.mjs whose caller frame was in scripts/tests/ and whose stack did not pass through scriptSource, with the suite run under MUTATION_SOURCE_ROOT pointing at a copy of the tree. Two reads remain deliberately direct: mutation-run.test.mjs compares scriptSource(name, {}) with the file at SCRIPTS_DIR (a test of scriptSource itself), and viewer-dedicated-fields.test.mjs inlinedTaskFields() executes task-fields.mjs the way the page inlines it, which is behaviour, not a text match. A static guard needs an allow marker for such lines, in the style of `renumber: allow`.

## Steps

1. Decide static (scan scripts/tests/*.mjs for readFileSync/readdirSync whose path is built from SCRIPTS_DIR, REPO_ROOT + scripts|bin, HERE + '..', or new URL('../x.mjs')) versus dynamic (a preload in one test that runs a sample), and record why.
2. Add the guard with a positive control: a fixture test file that reads scripts/x.mjs directly must be reported.
3. Mark the two deliberate direct reads with the chosen allow marker.

## Acceptance criteria

- [ ] The suite is green on the tree and the guard's positive control reports a fixture that reads a script's source directly. [proof: guard-red-on-fixture]
