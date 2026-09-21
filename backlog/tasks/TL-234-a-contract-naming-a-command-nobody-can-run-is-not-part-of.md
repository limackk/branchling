---
id: TL-234
title: "A contract naming a command nobody can run is not part of check"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: registered
    bash: "node scripts/cli.mjs check --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const g=JSON.parse(s).guards.map(x=>x.name);if(!g.includes('contracts'))process.exit(1);console.log('the guard is in the run — OK')})\""
  - id: suite
    bash: "node --test scripts/tests/contract-product-name.test.mjs"
---

## Goal

The audit written for TL-233 — an open task's `verification:` entry must not
name a command that is not this product — runs only when somebody runs the test
suite. `check` is where a person asks whether this backlog is sound, and this
finding belongs in that answer.

## Context

TL-233 closed a live defect: eleven `manual:` entries named `worktrail`, a  <!-- former-name: allow -->
binary that has not existed since 2026-09-03, and TL-122 was waiting for a
person to vouch for it by running one of them. The audit lives in
`scripts/tests/contract-product-name.test.mjs`, which exports pure functions —
`invocations`, `foreignInvocations`, `auditOpenContracts`.

It was NOT wired into `check` at the time for one reason, recorded in TL-233's
Decisions: `scripts/check-backlog-refs.mjs` and the guard table in
`scripts/check-backlog.mjs` were being edited in a second worktree in the same
session, and registering a guard is a change to that shared table.

A contract that cannot be followed is the same family of defect as a broken
criteria link, which `check` already reports.

## Pre-flight reading

1. `scripts/tests/contract-product-name.test.mjs` — the audit and why its signal
   is `<name> <subcommand>` in command position
2. `scripts/check-backlog.mjs` — the guard table, how a guard is registered and
   what a guard reports in `--json`
3. `scripts/check-backlog-proofs.mjs` — the shape of a backlog guard that reads
   tasks: `--dir`, exit codes, the count it prints as its own positive control

## Steps

1. Move the pure audit out of the test file into `scripts/check-backlog-contracts.mjs`,
   keeping the test as its caller — the logic is a guard, not an assertion.
2. Register it in the guard table so a bare `check` runs it and `--json` names it.
3. Decide whether it FAILS or REPORTS. Argument for failing: it is an instruction
   that is wrong today. Argument for reporting: a backlog imported from elsewhere
   would go red on somebody else's history. Write the decision down either way.
4. It reads tasks, so it takes `--dir` and judges the backlog it is pointed at —
   unlike `--product-name`, which judges this installation's source (TL-163).

## Acceptance criteria

- [x] `check` runs the contract audit and names it in `--json`. [proof: registered]
- [x] The audit still holds against this tree, with its positive control intact.
      [proof: suite]

## Decisions

**It FAILS; it does not report.** Both arguments are in step 3, and the finding
decided it: a `verification:` entry in a task nobody has closed is an
instruction somebody may follow tomorrow, so its correctness is a question about
today — the same question `docs` answers about a `related_docs` path that leads
nowhere, and that one fails without anybody arguing the file may come back. The
guards that report instead — `reasons`, `log-status`, `task-state` — all find
things in the past or mid-session, which is exactly what this guard refuses to
read. The decision was also forced by the acceptance criterion: an advisory
guard is not in a bare `check`, so it would not appear in `check --json` at all.

**The counter-argument is answered by a follow-up, not by a weaker verdict.** An
imported backlog could go red on a contract legitimately naming somebody else's
binary, because `plan`, `new` and `init` are other programs' verbs too. The
escape hatch is `FOREIGN_PROGRAMS`, which is another project's vocabulary living
in this tool's code — TL-413 moves it into `config.yaml`, where the third law
puts values.

**The zero sample is a bullet, not a tick and not a `!`.** `!` means a finding
the default run must not carry (TL-383), and a backlog with no open contract has
nothing to repair; a plain `✓` would read as ninety entries examined and clean.
So the line states the count and says "nothing was examined".

**The guard's own positive control is a spawned run, not a pure call.** The
audit already had a pure one. It could not catch a guard registered under the
wrong script, or one whose exit code stopped meaning anything, so the test now
builds a fixture backlog with a contract naming a foreign command and asserts
exit 1 and the finding's text.
