---
id: TL-194
title: "query --text and --limit work but are absent from query --help"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:sub-a
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: help-names-every-flag
    bash: 'for f in --text --limit --sort --type --owner --role --executor --blocked-by; do node scripts/cli.mjs query --help | grep -q -- "$f" || exit 1; done'
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

Eight flags that `query` accepts are invisible in `branchling query --help`:
`--text`, `--limit`, `--sort`, `--type`, `--owner`, `--role`, `--executor` and
`--blocked-by`. They work — `query --text envelope --count` answers, and an
unknown flag such as `--zzz` still fails with exit 2 and lists them all — but
nothing a reader of `--help` sees mentions them.

Once this is done, `query --help` describes every flag `query` accepts, and a
guard fails if the two lists ever diverge again.

## Context

Measured on 2026-09-03 while working on TL-184. The synopsis in
`scripts/cli.mjs` (the `query` entry of the command table) lists only

    query [--status s] [--priority p] [--board b] [--label l] [--epic e]
          [--modified-file <path>] [--json|--files|--count]

while the accepted list in `scripts/query.mjs` (the flag array around line 64)
is more than twice as long. The failure of an unknown flag prints the complete
list, so the information exists in the process — it is only the help that is
behind.

This matters more here than it would elsewhere. `--text` and `--limit` are the
two flags that make `query` answerable inside a context budget, which is what
the "ask, do not read" rule in `CLAUDE.md` tells every session to do; a flag
nobody can discover is a flag nobody uses.

## Pre-flight reading

1. `scripts/cli.mjs` — the `query` entry of the command table, where the usage
   text lives.
2. `scripts/query.mjs` — the accepted flag list, which is the truth this has to
   agree with.
3. `scripts/tests/help-*.test.mjs` (whichever file holds "a flag in the synopsis
   is required unless it stands in brackets") — this project already reads its
   own help as an interface, and the new guard belongs beside those.

## Steps

1. Describe the eight flags in the `query` usage, in the shape the neighbouring
   commands use — the synopsis line for the ones that belong there, prose for
   the rest.
2. Add a guard that compares the flags a command ACCEPTS with the flags its
   `--help` names, and fails on a flag that is accepted but never mentioned.
   Whether it covers every command or `query` alone is the decision to make
   while implementing; covering every command is likely to surface more of these.
3. A positive control: the guard must fail when a flag is removed from the help
   text of a command that still accepts it.

## Decisions

Nothing decided beyond the above. Whether any of the eight should be REMOVED
instead of documented is not assumed here — they are all reachable today.
