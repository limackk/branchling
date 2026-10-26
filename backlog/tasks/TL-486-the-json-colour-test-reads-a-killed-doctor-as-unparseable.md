---
id: TL-486
title: "The --json colour test reads a killed doctor as unparseable output"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-26
updated: 2026-10-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: ui
    bash: "node --test scripts/tests/ui.test.mjs"
  - id: suite
    bash: "npm test"
---

## Goal

`scripts/tests/ui.test.mjs` ("--json is NEVER coloured and always parses") passes on every run of the full suite, not only in isolation, and none of its assertion messages is in a language other than English.

## Context

On 2026-10-26, during the pre-publication run for 0.1.1, the test failed once inside `npm test` with `doctor --json: does not parse` / `Unexpected end of JSON input`. The test took 34 s; its `run()` helper spawns the CLI with `timeout: 30_000`, so `doctor --json` was killed under the load of the whole suite and the test parsed an empty stdout. The same file passed three consecutive isolated runs, and `branchling doctor --json` parses on its own. The failure reports the observer (machine load), not the code: the assertion should distinguish a killed child (`r.signal`, `r.error`) from output that does not parse, and the budget for `doctor` should be justified rather than a shared constant. The same assertion carries a Polish message, `sekwencje w JSON-ie`, which the repository's language rule forbids; it should read in English. A test that fails one run in many teaches everybody to re-run the suite until it is green — compare TL-481.

## Acceptance criteria

- [x] the --json test reports a killed child as such and its messages are English [proof: ui]
- [x] the whole suite stays green [proof: suite]
