---
id: TL-161
title: "query accepts a status outside the vocabulary and answers zero"
type: bug
labels: []
board: main
epic: "CLI surface"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: suite
    bash: "node --test scripts/tests/query-vocabulary.test.mjs"
  - id: refused
    bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" --no-example >/dev/null; node scripts/cli.mjs query --dir \"$d\" --status nope >/dev/null 2>&1 && { echo 'a status outside the vocabulary was accepted'; exit 1; }; echo 'the typo is refused — OK'"
---

## Goal

`worktrail query --status <value>` fails when the value is not in the project's
`statuses:`, instead of answering "0 matching tasks".

## Context

Found on 2026-09-02 while working on
[TL-83](TL-83-wejscie-komend-piszacych-enumy-ze-slownikow-i-append.md), which
made the WRITING commands describe and enforce their vocabularies. The reading
side was left as it was:

```
$ worktrail query --status nope
# 0 matching tasks (check whether the filters exclude one another)
```

That line is not a lie, and that is exactly the problem: **zero results caused
by a typo are indistinguishable from "there is nothing like that"**, and they
read like an answer. `query.mjs` says so about FLAGS in its own comment — "an
unknown flag MUST fail... zero results caused by a typo read like an answer" —
and then does not apply the same reasoning to a flag's VALUE.

The same applies to `--priority`, `--type`, `--board`, `--role` and, when
`labels_closed` is set, `--label`. `next` filters by the same axes through
`task-select.mjs` and has the same gap.

**What makes this more than pedantry.** An agent that queries `--status
in-progress` (a hyphen, not an underscore) is told there is no work in progress
and stops. That is the failure mode this project builds guards against, arriving
through the one command an agent uses most.

**The decision to make**, and to record: `--status` deliberately lifts the
default "active only" restriction, so it is also the flag people use to search
the archive. A refusal must not make that harder. Consider whether the message
should list the vocabulary the way `handoff` and `take` already do — they are
the precedent, and their wording is worth copying rather than reinventing.

**Out of scope:** `--epic` and `--text`, which are substring searches over free
text and have no vocabulary to check against; and `--owner`, whose vocabulary is
observed in the tree rather than declared.

## Pre-flight reading

1. `scripts/query.mjs` — the flag parsing and the `f` object; the comment about
   unknown flags states the principle this task extends to values.
2. `scripts/task-select.mjs` — `filterTasks`, shared with `next`; whichever fix
   is chosen has to cover both callers or deliberately not.
3. `scripts/take-task.mjs` — the wording of an existing "unknown status"
   refusal, and the list of permitted values it prints.

## Steps

1. Validate the vocabulary-bearing filter values against `config.yaml` before
   the scan, and fail with exit 2 naming the permitted values.
2. Decide whether `next` gets the same treatment, and record the reason either
   way.
3. `--tasks <dir>` bypasses the configuration, so there is nothing to validate
   against — that path must keep working rather than refusing everything.
4. Test with a fixture vocabulary of its own, and a positive control: a value
   INSIDE the vocabulary still answers, including zero.

## Acceptance criteria

- [ ] `query --status <not in the vocabulary>` exits non-zero and lists the permitted values. [proof: refused]
- [ ] A value inside the vocabulary still answers, including with zero matches. [proof: suite]
- [ ] `--tasks <dir>`, which has no configuration, is unaffected. [proof: suite]
- [ ] The decision about `next` is recorded with its reason. [proof: suite]
