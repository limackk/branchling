---
id: TL-592
title: "An empty requires_version line keeps the newer-release hint"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-592
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: empty-floor-keeps-hint
    bash: "node -e \"import('./scripts/config.mjs').then(m=>{const r=m.parseConfigYaml('requires_version: \\\"\\\"\\nsprint_calendar: x\\n');process.exit(r.problems.some(p=>p.includes('newer release may have written it'))?0:1)})\""
  - id: suite-file
    bash: "node --test scripts/tests/config-requires-version.test.mjs"
---

## Goal

A config.yaml whose requires_version line is empty is treated as stating no floor, so an unknown key with no near match still gets the newer-release hint.

## Context

Found in the TL-586 review. scripts/config.mjs parseConfigYaml decides the unknown-key message with `if (!near && !floor)` and the `: !floor` branch. When the file carries `requires_version: ""`, `floor` is an object even though its value is empty, so the hint that a newer release may have written the key is suppressed and newerKeys stays empty. The DEFAULTS comment says an empty value states no floor, so the two disagree. Reproduce: parseConfigYaml('requires_version: ""\nsprint_calendar: x\n') returns the plain '(allowed: ...)' problem and no newerKeys.

## Steps

1. Make the unknown-key branch test whether a floor VALUE is stated, not whether the requires_version line exists.
2. Add a test in scripts/tests/config-requires-version.test.mjs for an empty floor line, with the existing non-empty floor case as its control.

## Acceptance criteria

- [x] an empty requires_version line no longer suppresses the newer-release hint for an unknown key [proof: empty-floor-keeps-hint]
- [x] the existing floor tests still pass [proof: suite-file]
