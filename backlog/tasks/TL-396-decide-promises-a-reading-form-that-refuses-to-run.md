---
id: TL-396
title: "decide promises a reading form that refuses to run"
type: bug
labels: []
board: main
epic: "CLI surface"                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: the-documented-form-runs
    bash: "node scripts/cli.mjs decide TL-395 --json"
---

## Goal

`branchling decide <ID> [--json]` either works or stops being advertised. Today
`--help` prints it as the third of three usages and the command refuses it.

## Context

Found on 2026-09-21 while closing TL-395, which needed to read back the
decision it had just recorded.

    $ branchling decide TL-395 --json
    branchling decide: `--reason` is required unless a menu row is chosen

The same refusal comes back for the bare `branchling decide TL-395`. Both are
spelled out in the command's own usage block in `scripts/cli.mjs`:

    branchling decide <ID> --reason "…" [--resolves <event id>] [--actor <ns:name>]
    branchling decide <ID> --resolves <event id> --choose <n>
    branchling decide <ID> [--json] [--dir <path>]

and the help text under them describes what the reading form returns: "the
decision and what remains unanswered, for a program". Nothing returns it.

WHY THIS IS NOT COSMETIC. It is the failure TL-234 names — a contract naming an
invocation nobody can run — and it lands on the one axis this tool sells: law 4
promises `--json` on every reading command, so a program written against the
documented form gets an exit 2 and a sentence about a flag it deliberately did
not pass. TL-395 had to fall back to grepping `backlog/history/TL-395.jsonl` for
`__decision__` to prove its own acceptance criterion, which reads the ledger
around the tool rather than through it.

WHAT THE FIX IS NOT. Deleting the third usage line is the cheap way out and
should be rejected unless reading decisions really is out of scope: `audit` and
the viewer both surface decisions, so the data has readers already and only the
terminal has none.

## Pre-flight reading

1. `scripts/cli.mjs`, the `decide` entry — the three usages as written, so the
   fix restores what was promised rather than inventing a fourth.
2. `scripts/decide-command.mjs` (or whatever the entry's `script:` names) — where
   the `--reason` requirement is enforced, and whether it runs before or after
   the mode is chosen.
3. `scripts/json-envelope.mjs` — the declared shape for whichever kind the
   reading form returns; an undeclared key is refused, as TL-383 found.

## Steps

1. Decide whether the reading form ships or the usage line goes, and record it.
2. If it ships: make `decide <ID>` with no writing flag report the decisions on
   that task and what is still unanswered, in text and under `--json`.
3. A test that runs the invocation the usage block prints, so the two cannot
   drift apart again.

## Acceptance criteria

- [ ] Every invocation `decide --help` prints can be run.
      [proof: the-documented-form-runs]
