---
id: TL-353
title: "Profile adapter stderr proves an agent ran"
type: bug
labels: [agents, routing]
board: main
epic: "Controlled and observable agent execution"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-355]                   # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: profile-output-counts
    bash: "node --test scripts/tests/run-agent-profiles.test.mjs"
---

## Goal

Treat meaningful output from either stream of a profile adapter as evidence
that its agent ran. A model that inspected the task or ran its verification
must not be reported as an unmeasured, never-started attempt solely because its
adapter writes its transcript to stderr.

## Context

During the real role-routed TL-242 execution, `codex-dev-terra` launched
`codex exec --model gpt-5.6-terra` and ran the full test suite. The adapter
emitted the transcript on stderr. `workOne()` passed the combined streams to
the run log, but called `neverRan()` with stdout alone, then returned the claim
to the queue as if no execution had occurred. Do not use a successful exit code
as the substitute signal: an adapter may exit successfully without doing useful
work. Preserve the existing tree-change signal and make the evidence rule
explicit in a regression test.

## Pre-flight reading

1. `scripts/run-loop.mjs` — inspect the profile attempt, output capture and
   `neverRan()` decision.
2. `scripts/tests/run-agent-profiles.test.mjs` — extend the profile execution
   contract without weakening the silent-agent positive control.

1. `path/to/file` — what to look at there

## Steps

1. Define the execution-evidence rule for profile adapters so meaningful stderr
   counts equally with stdout.
2. Apply it before the run decides whether to release an unmeasured claim.
3. Add a regression case for a stderr-only profile adapter and retain the case
   where a silent, unchanged tree is released.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A profile adapter that writes only meaningful stderr is counted as an
      attempted execution, not released as `agent-never-ran`. [proof: profile-output-counts]
- [ ] A silent profile adapter that leaves the tree unchanged is still released
      without spending an attempt. [proof: profile-output-counts]
