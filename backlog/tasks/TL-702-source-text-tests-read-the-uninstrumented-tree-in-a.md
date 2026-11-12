---
id: TL-702
title: "Source-text tests read the uninstrumented tree in a mutation run"
type: task
labels: []
board: main
epic: "Viewer"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: awaiting_vouch  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: no-direct-source-read
    manual: "No test under scripts/tests/ reads scripts/<module>.mjs with readFileSync for a text match except through scriptSource(); evidence: the grep used and its output."
---

## Goal

Every test that matches a module's SOURCE TEXT reads it through `scriptSource()` from `scripts/tests/_repo.mjs`, so a mutation run over that module gets past Stryker's initial test run.

## Context

TL-653 found that a test which reads `scripts/<module>.mjs` from disk and matches it with a regex fails inside a mutation run: the sandbox copy is instrumented, every string literal wrapped in a mutant switch (`stryMutAct_…("…") ? "" : "-backlog"`), so the initial run goes red and no mutant is tried. TL-653 added `scriptSource(name)` in `scripts/tests/_repo.mjs`, which reads from the tree `scripts/mutation-run.mjs` names in `MUTATION_SOURCE_ROOT` (`SOURCE_ROOT_ENV`), and converted only `scripts/tests/viewer-storage-keys.test.mjs`. Other tests still read sources directly with `readFileSync(join(SCRIPTS_DIR|SCRIPTS, "<module>.mjs"))`, for example `cross-branch-state.test.mjs` (next-backlog-id.mjs and its callers), `release-view-one-reader.test.mjs`, `viewer-url.test.mjs`, `viewer-elsewhere-card.test.mjs` and `no-paren-plural.test.mjs` (which walks scripts/). Each of them fails a mutation run over the module it reads whenever a mutated line carries the text its regex looks for. A `--changed-lines` run hides this until the changed line is the one the regex matches, which is how TL-473 met it and TL-653's first reproduction missed it.

## Steps

1. List the tests that read a file under scripts/ (not a fixture, not the backlog) and match its text.
2. Route each through scriptSource(), or for a directory walk, through the same root.
3. Prove one conversion with a whole-module `npm run mutation -- --named-only --files <module>` that passes the initial test run.

## Acceptance criteria

- [ ] The default suite stays green after the conversion. [proof: suite-green]
- [ ] Source-text guards read the uninstrumented tree inside a mutation run. [proof: no-direct-source-read]
