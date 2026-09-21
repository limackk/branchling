---
id: TL-384
title: "Onboarding demonstrates evidence-gated agent delivery"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-21
blocked_by: [TL-377, TL-378, TL-379, TL-380, TL-381, TL-382, TL-383]
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
  - docs/demo/scenario.md
verification:
  - id: runnable-demonstrations
    bash: "node --test scripts/tests/demo-scenario.test.mjs scripts/tests/onboarding-evidence-loop.test.mjs"
  - id: package-gate
    bash: "node --test scripts/tests/publish-gate.test.mjs && npm pack --dry-run --json"
---

## Goal

The public front door demonstrates one product in minutes: repository-owned
selection, bounded agent execution and evidence-gated closure. A new user can
run three reproducible scenarios without learning removed telemetry, portfolio,
viewer-editing or fleet concepts.

## Context

This task runs only after the reduction tasks, because documenting the old
surface more clearly would preserve the wrong product. The three scenarios are
the validation gate for independent publication:

1. one agent stops and another continues from repository state;
2. two claim attempts do not duplicate work or cross the selected plan boundary;
3. an invalid completion is refused, repaired and then recorded as proven.

The README must state the boundary honestly: Branchling is not a tracker for
outside stakeholders and not a managed software factory. A demonstration may
use fixtures or local adapters but must not require paid credentials or network
access. External user comprehension is recorded by the founder separately; an
automated test proves only that the commands remain reproducible.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `README.md` — replace the feature catalogue with the one-agent evidence loop.
2. `docs/demo/scenario.md` — retain the refusal scene and remove stale commands.
3. `scripts/tests/demo-scenario.test.mjs` — keep documentation executable.
4. `package.json` and the dry-run tarball — ensure onboarding names only what
   actually ships.

## Steps

1. Rewrite the README opening and first five minutes around the trust boundary.
2. Provide three command-by-command, offline demonstrations for replacement,
   safe claiming and rejected completion.
3. State what Branchling deliberately does not own and point advanced users to
   ordinary Git or an external orchestrator.
4. Remove stale command, dependency and capability claims from every shipped
   onboarding document.
5. Test the transcripts against an isolated fixture and inspect the package
   contents through the release gate.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A fresh user can complete the core one-agent loop from the README without
      encountering a removed concept. [proof: runnable-demonstrations]
- [x] Provider replacement, safe claiming and rejected completion each have an
      offline, command-by-command demonstration. [proof: runnable-demonstrations]
- [x] The README distinguishes Branchling from both a task tracker and a managed
      multi-agent factory in its opening section. [proof: runnable-demonstrations]
- [x] Every documented command exists and the package contains every referenced
      shipped file. [proof: package-gate]
