---
id: TL-344
title: "Profile setup reuses a copied reference adapter"
type: task
labels: []
board: main
epic: "CLI onboarding"              # free text — the group this task counts towards
priority: P2
status: cancelled                  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/agent-profiles.mjs, backlog/tasks/TL-382-provider-execution-uses-one-thin-user-owned-adapter-path.md] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: reference-reuse
    bash: "node --test scripts/tests/agent-profile-setup.test.mjs"
---

## Goal

After setup copies a shipped reference adapter, a second profile using the same
provider defaults to the same destination and refuses because that file already
exists. The guide offers the existing copied adapter as a first-class reuse
choice, so one user-owned wrapper can serve multiple local profiles without
typing or discovering its path manually.

## Context

Profiles are recipes; adapters are executable wrappers. Requiring one copied
wrapper per profile multiplies code that is meant to be shared and turns the
recommended destination into a dead end on the second use. The current
`Use my own Branchling adapter` route can technically reuse the file, but it
asks a new user to know an internal configuration path.

Do not silently reuse an arbitrary executable from the filesystem or add a
global adapter registry. Reuse must be limited to local adapters Branchling
previously copied into the resolved profile scope, displayed with their path,
and remain an explicit choice. The ordinary custom-adapter path stays available
for user-authored wrappers.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — reference adapter discovery, copy boundary,
   and the shared profile interview.
2. `scripts/tests/agent-profile-setup.test.mjs` — setup transcript and
   no-write-until-confirmation controls.
3. `examples/agent-adapters/README.md` — public promise that copied adapters
   are ordinary reusable executables.

## Steps

1. Detect existing reference adapter destinations in the selected configuration
   scope without running them.
2. Present reuse beside copy and custom-adapter routes, with provider label and
   full destination path.
3. Keep the recommendation to copy when no reusable adapter exists.
4. Preserve cancellation and final-confirmation write boundaries.
5. Add transcript tests for reuse, a missing reusable destination, and custom
   adapter behavior.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A second Codex profile can select the first copied Codex adapter without
  typing its path or copying a second file. [proof: reference-reuse]
- [ ] The reuse selector shows the provider and user-owned destination and
  never runs the adapter. [proof: reference-reuse]
- [ ] With no copied reference adapter, setup retains the existing copy and
  custom-wrapper routes. [proof: reference-reuse]
- [ ] Cancelled, invalid, or unconfirmed reuse setup writes no profile and does
  not overwrite an adapter. [proof: reference-reuse]
