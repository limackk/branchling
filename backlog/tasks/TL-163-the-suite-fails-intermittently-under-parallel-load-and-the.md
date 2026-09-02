---
id: TL-163
title: "The suite fails intermittently under parallel load, and the message does not say why"
type: bug
labels: []
board: main
epic: "worktrail — the tool"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 4h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: repeated
    bash: "for i in 1 2 3 4 5; do node --test scripts/tests/*.test.mjs >/dev/null 2>&1 || exit 1; done; echo 'five consecutive full runs, all green — OK'"
---

## Goal

`node --test scripts/tests/*.test.mjs` gives the same answer every time it is
run, and a failure says which check failed rather than only `1 !== 0`.

## Context

Observed on 2026-09-02 while closing
[TL-84](TL-84-rozstrzygnac-i-zapisac-czy-reczna-edycja-pliku-taska-jest.md).
Three consecutive full runs of the suite gave: green, one failure, green. Two
different tests failed on different runs:

- `doctor exits non-zero on the failing direction and zero on the stale one`
  (`scripts/tests/log-status-agreement.test.mjs`)
- `new: the created task PASSES the guards and enters the views`
  (`scripts/tests/new-task.test.mjs`)

Both pass in isolation — the second was run alone immediately afterwards and was
green, and the first was run alone five times in a row, green each time.

**What they have in common** is the only lead worth following: both spawn
`worktrail doctor` or `worktrail check`, and `doctor` in turn spawns the WHOLE
`check` with a 60-second timeout (`scripts/doctor.mjs`, `checkGuards`). That run
includes `--language`, which reads over 70,000 lines across 320 files of this
installation. A timeout that is generous for one run is not obviously generous
when the runner has a hundred node processes in flight.

**Do not assume that is the cause.** An attempt to reproduce it deliberately —
eight full suites in parallel while probing the same fixture — did NOT reproduce
it, and a diagnosis that cannot be reproduced is a guess. The first step is to
make the failure say what it is, not to fix what it might be.

**Why this matters more than the two tests.** An intermittently red suite is the
one thing that teaches everybody to re-run rather than read, and after that a
real regression looks exactly like the flake. The project's own guards are worth
nothing the day somebody starts ignoring them.

## Pre-flight reading

1. `scripts/doctor.mjs` — `checkGuards`, the 60-second spawn timeout, and how a
   failed guard becomes an ERROR row and therefore a non-zero exit.
2. `scripts/tests/log-status-agreement.test.mjs` — the assertion now prints the
   whole `doctor` run in its message, which is the diagnostic added when this
   was found; the same is not yet true of the other test.
3. `scripts/check-public-language.mjs` — the guard that does the most reading,
   and the most likely thing to be slow.

## Steps

1. Make BOTH failing assertions carry the subprocess output in their message.
   Until a failure says which row or which guard did it, everything below is
   speculation.
2. Reproduce deliberately: run the suite under load in a loop until one fails,
   and keep the output.
3. Only then decide the fix. A longer timeout is one candidate and the least
   interesting; a `doctor` that does not need the language guard at all — it
   judges the INSTALLATION, not the backlog `doctor` was pointed at — may be the
   real answer.
4. Whatever the fix, prove it by running the whole suite five times over.

## Acceptance criteria

- [ ] Five consecutive full runs of the suite are green. [proof: repeated]
- [ ] A failing subprocess assertion in these two tests prints what the subprocess said. [proof: repeated]
- [ ] The cause is recorded, and it is a cause that was reproduced rather than inferred. [proof: repeated]

## Notes

Out of scope: making the suite faster. Speed is a separate concern from
determinism, and chasing both at once makes it impossible to say which change
fixed the flake.
