---
id: TL-413
title: "The programs a contract may name belong to the backlog, not to the guard"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: configured
    bash: "node --test scripts/tests/contract-product-name.test.mjs"
---

## Goal

`FOREIGN_PROGRAMS` in `scripts/check-backlog-contracts.mjs` is a list of other
people's binaries — `git`, `npm`, `cargo`, `docker` — written into this tool's
source. It is there so that `git init` and `npm run build` are not reported as
invocations of this tool under a wrong name. That makes it the VALUES of a
field, and this project's third law puts values in `backlog/config.yaml`, not in
the code.

Once this is done, a backlog whose tasks legitimately run `terraform plan`,
`helm init` or `dotnet new` can say so in its own configuration, and the
`contracts` guard stops being a gate that only this repository's vocabulary can
pass.

## Context

TL-233 wrote the audit as a test and TL-234 registered it as the `contracts`
guard, which FAILS rather than reports. The argument for failing is in that
module's header; the argument against it was that an imported backlog could go
red on a contract naming somebody else's binary, because `plan`, `new`, `init`,
`run` and `check` are other programs' verbs as well as this tool's. TL-234 left
`FOREIGN_PROGRAMS` as the escape hatch and recorded that making it the
consumer's own is this task.

The rejected alternative is on record too and should not be reopened without new
evidence: asking the machine whether the word resolves on `PATH` makes the
verdict depend on what happens to be installed, so a machine without `git` would
fail a task file nobody touched.

The shape of the field is the code's: a list of bare program names. The values
are the backlog's. An unknown key in `config.yaml` must still fail, and
`check --vocabulary` is the guard that judges configuration values.

## Pre-flight reading

1. `scripts/check-backlog-contracts.mjs` — `FOREIGN_PROGRAMS` and the header
   paragraph that names this task
2. `scripts/config.mjs` — how a key is declared, defaulted and validated
3. `scripts/check-backlog-vocabulary.mjs` — what judges the values a backlog
   declares

## Steps

1. Declare the key in `config.mjs` with the current list as its default, so an
   existing backlog behaves exactly as it does today.
2. Read it in the guard instead of the module constant; keep the exported
   constant only if something still needs the default by name.
3. Decide whether the key REPLACES the default or adds to it, and write the
   decision in the module header. A backlog that has to restate `git` and `npm`
   to add one name of its own will get it wrong.
4. Document the key wherever `config.yaml`'s keys are documented.

## Acceptance criteria

- [ ] The programs a contract may name come from `config.yaml`, and a backlog
      declaring one of its own stops the `contracts` guard failing on it.
      [proof: configured]
